import PlatformSchoolsPanel from "@/components/PlatformSchoolsPanel";

export default function PlatformPage() {
  return (
    <main className="min-h-screen bg-slate-50 p-4 md:p-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <header>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-700">Klasrum</p>
          <h1 className="mt-2 text-2xl font-black text-slate-900">Platform management</h1>
          <p className="mt-1 text-sm text-slate-500">School registration and tenant administration.</p>
        </header>
        <PlatformSchoolsPanel />
      </div>
    </main>
  );
}
