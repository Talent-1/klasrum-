"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Building2, Copy, Loader2, Plus, RefreshCw, ShieldCheck } from "lucide-react";

type SchoolRow = {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  created_at: string;
};

type CreatedResult = {
  school: { id: string; name: string; slug: string };
  administrator: { id: string; fullName: string; email: string; role: string; mustChangePassword: boolean };
  temporaryPassword: string;
  message: string;
};

export default function PlatformSchoolsPanel() {
  const [authorized, setAuthorized] = useState(false);
  const [checked, setChecked] = useState(false);
  const [schools, setSchools] = useState<SchoolRow[]>([]);
  const [schoolName, setSchoolName] = useState("");
  const [slug, setSlug] = useState("");
  const [adminFullName, setAdminFullName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [created, setCreated] = useState<CreatedResult | null>(null);
  const [copied, setCopied] = useState(false);

  const loadSchools = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/platform/schools", { cache: "no-store" });
      const result = await response.json();
      if (response.status === 403) {
        setAuthorized(false);
        return;
      }
      if (!response.ok) throw new Error(result.error || "Unable to load schools.");
      setAuthorized(true);
      setSchools(result.schools || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load platform data.");
    } finally {
      setLoading(false);
      setChecked(true);
    }
  };

  useEffect(() => { void loadSchools(); }, []);

  const registerSchool = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    setCreated(null);
    setCopied(false);

    try {
      const response = await fetch("/api/platform/schools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schoolName, slug, adminFullName, adminEmail }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "School registration failed.");

      setCreated(result as CreatedResult);
      setNotice(result.message || "School registered.");
      setSchoolName("");
      setSlug("");
      setAdminFullName("");
      setAdminEmail("");
      await loadSchools();
    } catch (e) {
      setError(e instanceof Error ? e.message : "School registration failed.");
    } finally {
      setSaving(false);
    }
  };

  const copyPassword = async () => {
    if (!created?.temporaryPassword) return;
    try {
      await navigator.clipboard.writeText(created.temporaryPassword);
      setCopied(true);
    } catch {
      setError("Clipboard access was unavailable. Select and copy the password manually.");
    }
  };

  if (loading && !checked) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Checking platform access...</div>;
  }

  if (!authorized) return null;

  return (
    <section className="space-y-5">
      <div className="rounded-2xl border border-blue-100 bg-blue-50 p-5">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-white text-blue-700"><ShieldCheck size={21} /></div>
          <div>
            <h2 className="font-bold text-lg text-blue-950">Klasrum Platform Owner</h2>
            <p className="text-sm text-blue-800">Manage school registrations. Each school remains a separate tenant with its own administrator and records.</p>
          </div>
        </div>
      </div>

      {error && <div role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
      {notice && <div className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</div>}

      {created && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 space-y-3">
          <h3 className="font-bold text-emerald-950">Administrator account created</h3>
          <p className="text-sm text-emerald-900">School: {created.school.name}</p>
          <p className="text-sm text-emerald-900">Administrator: {created.administrator.fullName} · {created.administrator.email}</p>
          <div>
            <label className="mb-1 block text-xs font-semibold text-emerald-900">Temporary password — shown only once</label>
            <div className="flex gap-2">
              <input className="field min-w-0 flex-1 font-mono" readOnly value={created.temporaryPassword} />
              <button type="button" className="btn btn-light shrink-0" onClick={() => void copyPassword()}><Copy size={15}/>{copied ? "Copied" : "Copy"}</button>
            </div>
          </div>
          <p className="text-xs text-emerald-800">Give this password securely to the administrator. Klasrum requires a new password at first login.</p>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_1.15fr]">
        <form onSubmit={registerSchool} className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
          <div className="flex items-center gap-2"><Plus size={18}/><h3 className="font-bold">Register a school</h3></div>
          <div><label className="label">School name *</label><input className="field" required maxLength={160} value={schoolName} onChange={(e) => { setSchoolName(e.target.value); if (!slug) setSlug(e.target.value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")); }} placeholder="Divine Destiny Secondary School"/></div>
          <div><label className="label">School URL slug *</label><input className="field" required maxLength={100} value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="divine-destiny-secondary-school-ogidi"/><p className="mt-1 text-xs text-slate-500">Lowercase letters, numbers and hyphens only.</p></div>
          <div><label className="label">Administrator full name *</label><input className="field" required maxLength={120} value={adminFullName} onChange={(e) => setAdminFullName(e.target.value)} placeholder="Full name of the school administrator"/></div>
          <div><label className="label">Administrator email *</label><input className="field" type="email" required maxLength={254} value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder="admin@school.com"/></div>
          <button className="btn btn-primary w-full justify-center" type="submit" disabled={saving}>
            {saving ? <><Loader2 size={16} className="animate-spin"/> Registering...</> : <><Plus size={16}/> Create school and administrator</>}
          </button>
          <p className="text-xs text-slate-500">This creates the tenant, its administrator's Supabase Auth account and the linked school profile. No school data is copied from another tenant.</p>
        </form>

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2"><Building2 size={18}/><h3 className="font-bold">Registered schools</h3></div>
            <button type="button" className="btn btn-light !px-3 !py-2" onClick={() => void loadSchools()} disabled={loading}><RefreshCw size={14} className={loading ? "animate-spin" : ""}/> Refresh</button>
          </div>
          {schools.length === 0 ? <p className="text-sm text-slate-500">No schools found.</p> : <div className="space-y-3">
            {schools.map((school) => (
              <div key={school.id} className="rounded-xl border border-slate-100 p-3">
                <div className="font-semibold">{school.name}</div>
                <div className="mt-1 text-xs text-slate-500">{school.slug}</div>
                <div className="mt-1 break-all text-[11px] text-slate-400">{school.id}</div>
              </div>
            ))}
          </div>}
        </div>
      </div>
    </section>
  );
}
