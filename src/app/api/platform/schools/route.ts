import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AuthResult =
  | { ok: true; user: any; admin: ReturnType<typeof createAdminClient> }
  | { ok: false; response: NextResponse };

async function getAuthenticatedClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Parameters<typeof cookieStore.set>[2] }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Cookie writes may be unavailable in some server-rendering contexts.
          }
        },
      },
    },
  );
}

async function authorizePlatformOwner(): Promise<AuthResult> {
  const supabase = await getAuthenticatedClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Please sign in again." }, { status: 401 }),
    };
  }

  if (user.app_metadata?.must_change_password === true) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Change your temporary password before using platform management." },
        { status: 403 },
      ),
    };
  }

  // This server-side allowlist is the bootstrap platform authority.
  // Never accept platform privileges from request data or user_metadata.
  const ownerIds = (process.env.KLASRUM_PLATFORM_OWNER_USER_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  if (!ownerIds.includes(user.id)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Platform Owner access is required." }, { status: 403 }),
    };
  }

  // Require the owner to remain an active school administrator as an
  // additional safeguard. Platform authority does not replace tenant identity.
  const schoolId = String(user.app_metadata?.school_id || "");
  if (!schoolId || user.app_metadata?.role !== "admin") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Your school administrator identity could not be verified." },
        { status: 403 },
      ),
    };
  }

  const admin = createAdminClient();
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id,school_id,role,is_active")
    .eq("id", user.id)
    .maybeSingle();

  if (
    profileError ||
    !profile ||
    profile.school_id !== schoolId ||
    profile.role !== "admin" ||
    profile.is_active !== true
  ) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Your active school administrator profile could not be verified." },
        { status: 403 },
      ),
    };
  }

  return { ok: true, user, admin };
}

function makeSlug(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function generateTemporaryPassword() {
  return randomBytes(24).toString("base64url");
}

export async function GET() {
  try {
    const auth = await authorizePlatformOwner();
    if (!auth.ok) return auth.response;

    const { data, error } = await auth.admin
      .from("schools")
      .select("id,name,slug,logo_url,created_at")
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Platform school list failed:", error);
      return NextResponse.json({ error: "Unable to load registered schools." }, { status: 500 });
    }

    return NextResponse.json({ authorized: true, schools: data || [] });
  } catch (error) {
    console.error("Platform school list failed:", error);
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let createdSchoolId: string | null = null;
  let createdAuthUserId: string | null = null;
  let adminClient: ReturnType<typeof createAdminClient> | null = null;

  try {
    const auth = await authorizePlatformOwner();
    if (!auth.ok) return auth.response;
    adminClient = auth.admin;

    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Send a valid JSON request." }, { status: 400 });
    }

    const schoolName = String(body.schoolName || "").trim();
    const suppliedSlug = String(body.slug || "").trim();
    const slug = suppliedSlug ? makeSlug(suppliedSlug) : makeSlug(schoolName);
    const adminFullName = String(body.adminFullName || "").trim();
    const adminEmail = String(body.adminEmail || "").trim().toLowerCase();

    if (!schoolName || schoolName.length > 160) {
      return NextResponse.json(
        { error: "Enter a school name (maximum 160 characters)." },
        { status: 400 },
      );
    }

    if (!slug || slug.length > 100 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      return NextResponse.json(
        { error: "Enter a valid school slug using lowercase letters, numbers and hyphens." },
        { status: 400 },
      );
    }

    if (!adminFullName || adminFullName.length > 120) {
      return NextResponse.json(
        { error: "Enter the new administrator's full name (maximum 120 characters)." },
        { status: 400 },
      );
    }

    if (!adminEmail || adminEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
      return NextResponse.json({ error: "Enter a valid administrator email address." }, { status: 400 });
    }

    const { data: school, error: schoolError } = await adminClient
      .from("schools")
      .insert({ name: schoolName, slug, logo_url: null })
      .select("id,name,slug")
      .single();

    if (schoolError || !school) {
      if (schoolError?.code === "23505") {
        return NextResponse.json(
          { error: "That school slug is already registered. Choose a different slug." },
          { status: 409 },
        );
      }
      console.error("School creation failed:", schoolError);
      return NextResponse.json(
        { error: "The school record could not be created." },
        { status: 500 },
      );
    }
    createdSchoolId = school.id;

    const temporaryPassword = generateTemporaryPassword();
    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email: adminEmail,
      password: temporaryPassword,
      email_confirm: true,
      app_metadata: {
        school_id: school.id,
        role: "admin",
        must_change_password: true,
      },
      user_metadata: { full_name: adminFullName },
    });

    if (createError || !created.user) {
      if (createError && /already|registered|exists/i.test(createError.message)) {
        await adminClient.from("schools").delete().eq("id", school.id);
        createdSchoolId = null;
        return NextResponse.json(
          { error: "An Auth account with that email already exists. Use a different email or the account-recovery process." },
          { status: 409 },
        );
      }
      console.error("School administrator Auth creation failed:", createError);
      await adminClient.from("schools").delete().eq("id", school.id);
      createdSchoolId = null;
      return NextResponse.json(
        { error: "The school administrator account could not be created. The incomplete school record was rolled back." },
        { status: 400 },
      );
    }
    createdAuthUserId = created.user.id;

    const { error: profileError } = await adminClient.from("profiles").insert({
      id: created.user.id,
      school_id: school.id,
      role: "admin",
      full_name: adminFullName,
      email: adminEmail,
      is_active: true,
    });

    if (profileError) {
      console.error("School administrator profile creation failed:", profileError);
      const authCleanup = await adminClient.auth.admin.deleteUser(created.user.id);
      const schoolCleanup = await adminClient.from("schools").delete().eq("id", school.id);
      if (authCleanup.error || schoolCleanup.error) {
        console.error("School onboarding rollback incomplete:", {
          authCleanupError: authCleanup.error,
          schoolCleanupError: schoolCleanup.error,
        });
      }
      createdAuthUserId = null;
      createdSchoolId = null;
      return NextResponse.json(
        { error: "The administrator profile could not be linked. Klasrum attempted to roll back the incomplete school registration; check server logs if cleanup needs attention." },
        { status: 500 },
      );
    }

    return NextResponse.json(
      {
        school,
        administrator: {
          id: created.user.id,
          fullName: adminFullName,
          email: adminEmail,
          role: "admin",
          mustChangePassword: true,
        },
        temporaryPassword,
        message: "School and administrator created. Copy the temporary password now; it will not be displayed again.",
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Platform school onboarding failed:", error);

    // Best-effort compensation for unexpected failures after record creation.
    if (adminClient && createdAuthUserId) {
      const { error } = await adminClient.auth.admin.deleteUser(createdAuthUserId);
      if (error) console.error("Failed to roll back Auth user:", error);
    }
    if (adminClient && createdSchoolId) {
      const { error } = await adminClient.from("schools").delete().eq("id", createdSchoolId);
      if (error) console.error("Failed to roll back school row:", error);
    }

    return NextResponse.json(
      { error: "An unexpected error prevented school registration. Any partial records were subject to rollback." },
      { status: 500 },
    );
  }
}
