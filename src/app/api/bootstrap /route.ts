import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const SCHOOL_NAME = "Bright Day Academy, Ogidi";
const SCHOOL_SLUG = "bright-day-academy-ogidi";

function isValidSecret(provided: string, expected: string) {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);

  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  try {
    // 1. Verify the one-time bootstrap secret.
    const expectedSecret = process.env.BOOTSTRAP_SECRET;
    const providedSecret = request.headers.get("x-bootstrap-secret");

    if (
      !expectedSecret ||
      !providedSecret ||
      !isValidSecret(providedSecret, expectedSecret)
    ) {
      return NextResponse.json(
        { error: "Unauthorized." },
        { status: 401 }
      );
    }

   // 2. Read and validate administrator details.
   
let body: unknown;

try {
  body = await request.json();
} catch {
  return NextResponse.json(
    { error: "Invalid JSON request." },
    { status: 400 }
  );
}

if (
  !body ||
  typeof body !== "object" ||
  Array.isArray(body)
) {
  return NextResponse.json(
    { error: "Invalid request body." },
    { status: 400 }
  );
}

const input = body as Record<string, unknown>;

const fullName =
  typeof input.fullName === "string"
    ? input.fullName.trim()
    : "";

const email =
  typeof input.email === "string"
    ? input.email.trim().toLowerCase()
    : "";

const password =
  typeof input.password === "string"
    ? input.password
    : "";

if (
  !fullName ||
  fullName.length > 100 ||
  !email ||
  !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
  password.length < 12 ||
  password.length > 128
) {
  return NextResponse.json(
    {
      error:
        "Enter a valid name and email. Password must be at least 12 characters.",
    },
    { status: 400 }
  );
}

    // 3. Connect using the server-only admin client.
    const supabase = createAdminClient();

    // 4. Refuse bootstrap if an Auth user already exists.
    const { data: usersData, error: usersError } =
      await supabase.auth.admin.listUsers({
        page: 1,
        perPage: 1,
      });

    if (usersError) {
      throw usersError;
    }

    if (usersData.users.length > 0) {
      return NextResponse.json(
        { error: "Bootstrap is locked: an Auth user already exists." },
        { status: 409 }
      );
    }

    // 5. Refuse bootstrap if a profile already exists.
    const { count, error: profileCheckError } = await supabase
      .from("profiles")
      .select("id", { count: "exact", head: true });

    if (profileCheckError) {
      throw profileCheckError;
    }

    if ((count ?? 0) > 0) {
      return NextResponse.json(
        { error: "Bootstrap is locked: profiles already exist." },
        { status: 409 }
      );
    }

    // 6. Create the demonstration school.
    const { data: school, error: schoolError } = await supabase
      .from("schools")
      .insert({
        name: SCHOOL_NAME,
        slug: SCHOOL_SLUG,
      })
      .select("id")
      .single();

    if (schoolError) {
      throw schoolError;
    }

    // 7. Create the first school administrator.
    const { data: authData, error: authError } =
      await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        app_metadata: {
          school_id: school.id,
          role: "admin",
        },
        user_metadata: {
          full_name: fullName,
        },
      });

    if (authError) {
      await supabase
        .from("schools")
        .delete()
        .eq("id", school.id);

      throw authError;
    }

    // 8. Create the matching profile.
    const { error: profileError } = await supabase
      .from("profiles")
      .insert({
        id: authData.user.id,
        school_id: school.id,
        role: "admin",
        full_name: fullName,
        email,
      });

    if (profileError) {
      // Compensate if profile creation fails.
      await supabase.auth.admin.deleteUser(authData.user.id);

      await supabase
        .from("schools")
        .delete()
        .eq("id", school.id);

      throw profileError;
    }

    // 9. Confirm successful setup.
    return NextResponse.json({
      success: true,
      message: "Bright Day Academy has been created successfully.",
      school: SCHOOL_NAME,
      administrator: email,
    });

  } catch (error) {
    console.error("Bootstrap error:", error);

    return NextResponse.json(
      { error: "Bootstrap failed. Check the server logs." },
      { status: 500 }
    );
  }
}