import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

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
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
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
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
    }

    if (user.app_metadata?.must_change_password === true) {
      return NextResponse.json(
        { error: "Change your temporary password before creating accounts." },
        { status: 403 },
      );
    }

    const schoolId = String(user.app_metadata?.school_id || "");
    if (!schoolId || user.app_metadata?.role !== "admin") {
      return NextResponse.json(
        { error: "Only a school administrator can create teacher accounts." },
        { status: 403 },
      );
    }

    const admin = createAdminClient();
    const { data: adminProfile, error: profileCheckError } = await admin
      .from("profiles")
      .select("id,school_id,role,is_active")
      .eq("id", user.id)
      .single();

    if (
      profileCheckError ||
      !adminProfile ||
      adminProfile.school_id !== schoolId ||
      adminProfile.role !== "admin" ||
      !adminProfile.is_active
    ) {
      return NextResponse.json(
        { error: "Your administrator profile could not be verified." },
        { status: 403 },
      );
    }

    const body = await request.json();
    const fullName = String(body.fullName || "").trim();
    const email = String(body.email || "").trim().toLowerCase();

    if (!fullName || fullName.length > 120) {
      return NextResponse.json(
        { error: "Enter a valid teacher name (maximum 120 characters)." },
        { status: 400 },
      );
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
        return NextResponse.json(
          { error: "An account with this email already exists. Use a different email or the account-recovery process." },
          { status: 409 },
        );
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
      return NextResponse.json(
        { error: `Teacher account could not be linked to the school profile: ${insertError.message}` },
        { status: 500 },
      );
    }

    return NextResponse.json(
      {
        teacher: {
          id: created.user.id,
          full_name: fullName,
          email,
          is_active: true,
          role: "teacher",
        },
        temporaryPassword,
        message: "Teacher account created. Save the temporary password now; it will only be displayed once.",
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Teacher account creation failed:", error);
    return NextResponse.json(
      { error: "An unexpected server error prevented teacher account creation." },
      { status: 500 },
    );
  }
}
// Correct an existing teacher's login email without creating a new Auth user.
// The school administrator must provide the teacher's existing user ID and
// current email as a safeguard against changing the wrong account.
export async function PATCH(request: Request) {
  try {
    const supabase = await getAuthenticatedClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
    }

    if (user.app_metadata?.must_change_password === true) {
      return NextResponse.json(
        { error: "Change your temporary password before managing accounts." },
        { status: 403 },
      );
    }

    const schoolId = String(user.app_metadata?.school_id || "");
    if (!schoolId || user.app_metadata?.role !== "admin") {
      return NextResponse.json(
        { error: "Only a school administrator can correct teacher account details." },
        { status: 403 },
      );
    }

    const admin = createAdminClient();
    const { data: adminProfile, error: profileCheckError } = await admin
      .from("profiles")
      .select("id,school_id,role,is_active")
      .eq("id", user.id)
      .single();

    if (
      profileCheckError ||
      !adminProfile ||
      adminProfile.school_id !== schoolId ||
      adminProfile.role !== "admin" ||
      !adminProfile.is_active
    ) {
      return NextResponse.json(
        { error: "Your administrator profile could not be verified." },
        { status: 403 },
      );
    }

    const body = await request.json();
    const teacherId = String(body.teacherId || "").trim();
    const expectedCurrentEmail = String(body.expectedCurrentEmail || "").trim().toLowerCase();
    const newEmail = String(body.newEmail || "").trim().toLowerCase();

    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!uuidPattern.test(teacherId)) {
      return NextResponse.json({ error: "A valid teacher account ID is required." }, { status: 400 });
    }

    if (
      !expectedCurrentEmail ||
      expectedCurrentEmail.length > 254 ||
      !emailPattern.test(expectedCurrentEmail)
    ) {
      return NextResponse.json({ error: "The teacher's current registered email is invalid." }, { status: 400 });
    }

    if (!newEmail || newEmail.length > 254 || !emailPattern.test(newEmail)) {
      return NextResponse.json({ error: "Enter a valid replacement email address." }, { status: 400 });
    }

    if (newEmail === expectedCurrentEmail) {
      return NextResponse.json({ error: "The replacement email is the same as the current email." }, { status: 400 });
    }

    const { data: teacherResult, error: teacherAuthError } =
      await admin.auth.admin.getUserById(teacherId);

    const teacherAuthUser = teacherResult?.user;
    if (teacherAuthError || !teacherAuthUser) {
      return NextResponse.json({ error: "The teacher's Auth account could not be found." }, { status: 404 });
    }

    if (
      String(teacherAuthUser.app_metadata?.school_id || "") !== schoolId ||
      teacherAuthUser.app_metadata?.role !== "teacher"
    ) {
      return NextResponse.json(
        { error: "This account is not a teacher account belonging to your school." },
        { status: 403 },
      );
    }

    if (String(teacherAuthUser.email || "").toLowerCase() !== expectedCurrentEmail) {
      return NextResponse.json(
        { error: "The current email does not match this teacher account. No changes were made." },
        { status: 409 },
      );
    }

    const { data: teacherProfile, error: teacherProfileError } = await admin
      .from("profiles")
      .select("id,school_id,role,email")
      .eq("id", teacherId)
      .single();

    if (
      teacherProfileError ||
      !teacherProfile ||
      teacherProfile.school_id !== schoolId ||
      teacherProfile.role !== "teacher"
    ) {
      return NextResponse.json(
        { error: "The teacher's school profile could not be verified. No changes were made." },
        { status: 403 },
      );
    }

    // Supabase Auth enforces email uniqueness. email_confirm is set only because
    // the administrator has confirmed the teacher personally supplied this address.
    const { data: updatedAuth, error: updateAuthError } =
      await admin.auth.admin.updateUserById(teacherId, {
        email: newEmail,
        email_confirm: true,
      });

    if (updateAuthError || !updatedAuth.user) {
      const message = updateAuthError?.message || "Supabase did not confirm the email update.";
      if (/already|registered|exists/i.test(message)) {
        return NextResponse.json(
          { error: "That email address is already registered to another account." },
          { status: 409 },
        );
      }
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const { error: updateProfileError } = await admin
      .from("profiles")
      .update({ email: newEmail })
      .eq("id", teacherId)
      .eq("school_id", schoolId)
      .eq("role", "teacher");

    if (updateProfileError) {
      // Attempt to keep Auth and the school profile consistent if the profile
      // update fails. The account ID and password remain unchanged.
      const { error: rollbackError } = await admin.auth.admin.updateUserById(teacherId, {
        email: expectedCurrentEmail,
        email_confirm: true,
      });

      console.error("Teacher profile email update failed:", updateProfileError);
      if (rollbackError) {
        console.error("Teacher Auth email rollback failed:", rollbackError);
      }

      return NextResponse.json(
        {
          error: rollbackError
            ? "The profile update failed and automatic rollback also failed. Please contact platform support before the teacher signs in."
            : "The school profile could not be updated, so the Auth email change was rolled back. No final change was made.",
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      teacher: {
        id: teacherId,
        email: newEmail,
      },
      message: "Teacher email corrected. The existing account, password, and assignments were preserved.",
    });
  } catch (error) {
    console.error("Teacher email correction failed:", error);
    return NextResponse.json(
      { error: "An unexpected server error prevented the teacher email correction." },
      { status: 500 },
    );
  }
}
