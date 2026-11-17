import { NextRequest, NextResponse } from "next/server";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const SCHOOL_NAME = "Bright Day Academy, Ogidi";
const SCHOOL_SLUG = "bright-day-academy-ogidi";

// Delete a newly created Auth user during rollback.
async function cleanupBootstrap(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string
): Promise<boolean> {
  try {
    const { error } =
      await supabase.auth.admin.deleteUser(userId);

    if (error) {
      console.error(
        "Bootstrap Auth cleanup failed:",
        error.message
      );

      return false;
    }

    return true;
  } catch (error) {
    console.error(
      "Unexpected Auth cleanup failure:",
      error
    );

    return false;
  }
}

// Compare bootstrap secrets safely.
function isValidSecret(
  provided: string,
  expected: string
): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);

  return (
    a.length === b.length &&
    timingSafeEqual(a, b)
  );
}

export async function POST(request: NextRequest) {
  let supabase: ReturnType<typeof createAdminClient> | null = null;

  let bootstrapToken: string | null = null;

  let lockClaimed = false;
  let lockCompleted = false;
  let preserveLock = false;

  try {
    // 1. Verify the one-time bootstrap secret.

    const expectedSecret = process.env.BOOTSTRAP_SECRET;

    const providedSecret = request.headers.get(
      "x-bootstrap-secret"
    );

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

    supabase = createAdminClient();

    // 4. Claim the atomic one-time bootstrap lock.

    bootstrapToken = randomUUID();

    const { data: lockResult, error: lockError } =
      await supabase.rpc("claim_bootstrap", {
        p_token: bootstrapToken,
      });

    if (lockError) {
      throw lockError;
    }

    if (!lockResult) {
      return NextResponse.json(
        {
          error:
            "Bootstrap has already been claimed or completed.",
        },
        { status: 409 }
      );
    }

    lockClaimed = true;

    // 5. Check whether an Auth user already exists.

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
        {
          error:
            "Bootstrap is locked: an Auth user already exists.",
        },
        { status: 409 }
      );
    }

    // 6. Check whether a profile already exists.

    const { count, error: profileCheckError } =
      await supabase
        .from("profiles")
        .select("id", {
          count: "exact",
          head: true,
        });

    if (profileCheckError) {
      throw profileCheckError;
    }

    if ((count ?? 0) > 0) {
      return NextResponse.json(
        {
          error:
            "Bootstrap is locked: profiles already exist.",
        },
        { status: 409 }
      );
    }

    // 7. Retrieve the existing demonstration school.

    const { data: school, error: schoolError } =
      await supabase
        .from("schools")
        .select("id, name, slug")
        .eq("slug", SCHOOL_SLUG)
        .maybeSingle();

    if (schoolError) {
      throw schoolError;
    }

    if (
      !school ||
      school.name !== SCHOOL_NAME ||
      school.slug !== SCHOOL_SLUG
    ) {
      throw new Error(
        "Demonstration school record not found or does not match."
      );
    }

    // 8. Create the first school administrator.

    // Preserve the lock while Auth creation is in progress.
    // This protects against uncertain network outcomes.

    preserveLock = true;

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
      // Auth explicitly reported failure.
      preserveLock = false;

      throw authError;
    }

    // 9. Create the matching administrator profile.

    const { error: profileError } =
      await supabase
        .from("profiles")
        .insert({
          id: authData.user.id,
          school_id: school.id,
          role: "admin",
          full_name: fullName,
          email,
        });

    if (profileError) {
      // Roll back the newly created Auth user.

      const cleanupSucceeded = await cleanupBootstrap(
        supabase,
        authData.user.id
      );

      if (cleanupSucceeded) {
        preserveLock = false;
      } else {
        console.error(
          "Bootstrap rollback incomplete. Lock preserved."
        );
      }

      throw profileError;
    }

    // 10. Permanently complete the bootstrap lock.

    // Keep the lock if completion fails.
    preserveLock = true;

    const {
      data: completionResult,
      error: completionError,
    } = await supabase.rpc("complete_bootstrap", {
      p_token: bootstrapToken,
    });

    if (completionError) {
      throw completionError;
    }

    if (!completionResult) {
      throw new Error(
        "Bootstrap completion could not be confirmed."
      );
    }

    lockCompleted = true;

    // 11. Return successful setup response.

    return NextResponse.json({
      success: true,
      message:
        "Bright Day Academy administrator created successfully.",
      school: SCHOOL_NAME,
      administrator: email,
    });

  } catch (error) {
    console.error("Bootstrap error:", error);

    return NextResponse.json(
      {
        error:
          "Bootstrap failed. Check the server logs.",
      },
      { status: 500 }
    );

  } finally {
    // 12. Release the lock after a safely recoverable failure.

    if (
      lockClaimed &&
      !lockCompleted &&
      !preserveLock &&
      supabase &&
      bootstrapToken
    ) {
      try {
        const { error: releaseError } =
          await supabase.rpc("release_bootstrap", {
            p_token: bootstrapToken,
          });

        if (releaseError) {
          console.error(
            "Bootstrap lock release failed:",
            releaseError.message
          );
        }
      } catch (error) {
        console.error(
          "Unexpected bootstrap lock release failure:",
          error
        );
      }
    }
  }
}