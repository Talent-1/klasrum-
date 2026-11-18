"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, KeyRound, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function ChangePasswordPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!mounted) return;
      if (!user) { router.replace("/login"); return; }
      if (user.app_metadata?.must_change_password !== true) { router.replace("/"); return; }
      setEmail(user.email || "");
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, [router, supabase]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(""); setNotice("");
    if (password.length < 12) { setError("Use at least 12 characters for your new password."); return; }
    if (password !== confirmPassword) { setError("The two passwords do not match."); return; }
    setSaving(true);
    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to change password.");
      setNotice("Password changed. Please sign in again using your new password.");
      await supabase.auth.signOut();
      window.setTimeout(() => router.replace("/login"), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to change password.");
    } finally { setSaving(false); }
  };

  if (loading) return <main className="min-h-screen grid place-items-center bg-slate-50 text-sm text-slate-500">Checking your account...</main>;

  return <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
    <section className="w-full max-w-md rounded-3xl bg-white border border-slate-200 shadow-sm p-6 sm:p-8">
      <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-700 grid place-items-center"><KeyRound size={23}/></div>
      <h1 className="text-2xl font-black mt-5">Set your personal password</h1>
      <p className="text-sm text-slate-500 mt-2">Welcome to Klasrum. Your school created this account for you. For security, choose a new password before continuing.</p>
      <div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm"><span className="text-slate-500">Account:</span> <strong className="break-all">{email}</strong></div>
      <form onSubmit={submit} className="mt-5 space-y-4">
        <div><label className="label">New password</label><div className="flex gap-2"><input className="field" required minLength={12} maxLength={128} autoComplete="new-password" type={showPassword ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 12 characters"/><button className="btn btn-light shrink-0" type="button" onClick={() => setShowPassword(v => !v)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div></div>
        <div><label className="label">Confirm new password</label><div className="flex gap-2"><input className="field" required minLength={12} maxLength={128} autoComplete="new-password" type={showConfirm ? "text" : "password"} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Enter the new password again"/><button className="btn btn-light shrink-0" type="button" onClick={() => setShowConfirm(v => !v)} aria-label={showConfirm ? "Hide confirmation" : "Show confirmation"}>{showConfirm ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div></div>
        <p className="text-xs text-slate-500 flex items-start gap-2"><ShieldCheck size={15} className="shrink-0 mt-0.5"/> Use a password you have not used elsewhere. Klasrum never stores your password in its school records.</p>
        {error && <div className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
        {notice && <div className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</div>}
        <button className="btn btn-primary w-full justify-center" type="submit" disabled={saving}>{saving ? "Updating password..." : "Save new password"}</button>
      </form>
    </section>
  </main>;
}
