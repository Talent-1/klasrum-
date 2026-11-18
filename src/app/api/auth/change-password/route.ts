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
        setAll(
  cookiesToSet: {
    name: string;
    value: string;
    options?: Parameters<typeof cookieStore.set>[2];
  }[]
) {
  try {
    cookiesToSet.forEach(({ name, value, options }) => {
      cookieStore.set(name, value, options);
    });
  } catch {
    // The cookie update can be ignored in Server Components.
  }
},
      },
    },
  );
}

export async function POST(request: Request) {
  try {
    const supabase = await getAuthenticatedClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "Your session has expired. Please sign in again." }, { status: 401 });
    if (user.app_metadata?.must_change_password !== true) {
      return NextResponse.json({ error: "A password change is not currently required for this account." }, { status: 409 });
    }

    const body = await request.json();
    const password = String(body.password || "");
    if (password.length < 12 || password.length > 128) {
      return NextResponse.json({ error: "Your new password must contain between 12 and 128 characters." }, { status: 400 });
    }

    const { error: passwordError } = await supabase.auth.updateUser({ password });
    if (passwordError) return NextResponse.json({ error: passwordError.message }, { status: 400 });

    const admin = createAdminClient();
    const { error: metadataError } = await admin.auth.admin.updateUserById(user.id, {
      app_metadata: { ...user.app_metadata, must_change_password: false },
    });
    if (metadataError) {
      console.error("Password changed but first-login flag update failed:", metadataError);
      return NextResponse.json({ error: "Your password was changed, but Klasrum could not finish activating the account. Please contact your school administrator." }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: "Password changed successfully. Sign in again with your new password." });
  } catch (error) {
    console.error("First-login password change failed:", error);
    return NextResponse.json({ error: "An unexpected error prevented the password change." }, { status: 500 });
  }
}
