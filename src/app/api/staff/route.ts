import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

async function getAuthenticatedClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Cookie writes can be unavailable in a Server Component render.
          }
        },
      },
    },
  );
}

function generateTemporaryPassword() {
  // 24 random bytes produce a high-entropy, URL-safe temporary password.
  return randomBytes(24).toString("base64url");
}

export async function POST(request: Request) {
  try {
    const supabase = await getAuthenticatedClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });

    if (user.app_metadata?.must_change_password === true) {
      return NextResponse.json({ error: "Change your temporary password before creating accounts." }, { status: 403 });
    }

    const schoolId = String(user.app_metadata?.school_id || "");
    if (!schoolId || user.app_metadata?.role !== "admin") {
      return NextResponse.json({ error: "Only a school administrator can create teacher accounts." }, { status: 403 });
    }

    const admin = createAdminClient();
    const { data: adminProfile, error: profileCheckError } = await admin
      .from("profiles")
      .select("id,school_id,role,is_active")
      .eq("id", user.id)
      .single();
    if (profileCheckError || !adminProfile || adminProfile.school_id !== schoolId || adminProfile.role !== "admin" || !adminProfile.is_active) {
      return NextResponse.json({ error: "Your administrator profile could not be verified." }, { status: 403 });
    }

    const body = await request.json();
    const fullName = String(body.fullName || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    if (!fullName || fullName.length > 120) {
      return NextResponse.json({ error: "Enter a valid teacher name (maximum 120 characters)." }, { status: 400 });
    }
    if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    }

    const temporaryPassword = generateTemporaryPassword();
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password: temporaryPassword,
      email_confirm: true,
      app_metadata: {
        school_id: schoolId,
        role: "teacher",
        must_change_password: true,
      },
      user_metadata: { full_name: fullName },
    });
    if (createError || !created.user) {
      const message = createError?.message || "Supabase did not return the created teacher account.";
      if (/already|registered|exists/i.test(message)) {
        return NextResponse.json({ error: "An account with this email already exists. Use a different email or the account-recovery process." }, { status: 409 });
      }
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const { error: insertError } = await admin.from("profiles").insert({
      id: created.user.id,
      school_id: schoolId,
      role: "teacher",
      full_name: fullName,
      email,
      is_active: true,
    });

    if (insertError) {
      await admin.auth.admin.deleteUser(created.user.id);
      return NextResponse.json({ error: `Teacher account could not be linked to the school profile: ${insertError.message}` }, { status: 500 });
    }

    return NextResponse.json({
      teacher: { id: created.user.id, full_name: fullName, email, is_active: true, role: "teacher" },
      temporaryPassword,
      message: "Teacher account created. Save the temporary password now; it will only be displayed once.",
    }, { status: 201 });
  } catch (error) {
    console.error("Teacher account creation failed:", error);
    return NextResponse.json({ error: "An unexpected server error prevented teacher account creation." }, { status: 500 });
  }
}
