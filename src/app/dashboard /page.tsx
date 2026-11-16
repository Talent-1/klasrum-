import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

const allowedRoles = ["admin", "teacher", "student"];

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createClient();

  // Verify the authenticated user on the server.
  const { data: { user }, error } =
    await supabase.auth.getUser();

  if (error || !user) {
    redirect("/login");
  }

  // Read trusted role information from app_metadata.
  const role = user.app_metadata?.role;
  const schoolId = user.app_metadata?.school_id;

  // An authenticated user without valid school
  // provisioning must not enter a school workspace.
  if (
    !allowedRoles.includes(role) ||
    !schoolId
  ) {
    return (
      <main className="min-h-screen bg-slate-100 flex items-center justify-center p-5">
        <div className="bg-white rounded-2xl shadow-sm border p-7 max-w-md w-full text-center">

          <div className="text-4xl mb-4">🔐</div>

          <h1 className="text-2xl font-bold text-slate-900">
            Account setup incomplete
          </h1>

          <p className="text-slate-600 mt-3">
            Your account is authenticated, but it has not
            yet been assigned a valid Klasrum school
            workspace and role.
          </p>

          <p className="text-sm text-slate-400 mt-4">
            Please contact your Klasrum administrator.
          </p>

        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 p-6">

      <div className="max-w-5xl mx-auto">

        <header className="bg-white rounded-2xl border p-6 mb-6">
          <p className="text-sm text-blue-600 font-semibold">
            KLASRUM WORKSPACE
          </p>

          <h1 className="text-2xl font-bold text-slate-900 mt-2">
            Welcome to Klasrum
          </h1>

          <p className="text-slate-500 mt-2">
            You are successfully authenticated.
          </p>
        </header>

        <section className="grid gap-4 sm:grid-cols-2">

          <div className="bg-white rounded-2xl border p-6">
            <p className="text-sm text-slate-500">
              Signed in as
            </p>

            <p className="font-semibold text-slate-900 mt-2 break-all">
              {user.email}
            </p>
          </div>

          <div className="bg-white rounded-2xl border p-6">
            <p className="text-sm text-slate-500">
              Your role
            </p>

            <p className="font-semibold text-slate-900 mt-2 capitalize">
              {role}
            </p>
          </div>

        </section>

        <div className="mt-6 bg-blue-50 border border-blue-100 rounded-2xl p-5">
          <p className="text-blue-900 font-semibold">
            Your school workspace is recognised.
          </p>

          <p className="text-sm text-blue-700 mt-1">
            We will connect your role-specific dashboard
            and school records in the next development stage.
          </p>
        </div>

      </div>

    </main>
  );
}