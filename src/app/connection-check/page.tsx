import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function ConnectionCheck() {
const supabase = await createClient();

const { data, error } = await supabase
.from("schools")
.select("id")
.limit(1);

return (
<main className="min-h-screen bg-slate-50 p-6 flex items-center justify-center">
<div className="bg-white rounded-2xl shadow-sm border p-6 max-w-md w-full">
<h1 className="text-xl font-bold mb-3">
Klasrum Database Test
</h1>

    {error ? (
      <div className="text-red-600">
        <p className="font-bold">Connection test failed</p>
        <p className="text-sm mt-2">{error.message}</p>
      </div>
    ) : (
      <div className="text-emerald-700">
        <p className="font-bold">Supabase connection successful!</p>
        <p className="text-sm mt-2">
          Klasrum successfully queried the schools table.
        </p>
        <p className="text-sm mt-2">
          Rows returned: {data?.length ?? 0}
        </p>
      </div>
    )}
  </div>
</main>

);
}