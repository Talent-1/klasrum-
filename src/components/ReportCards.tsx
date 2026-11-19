"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, FileText, Printer, RefreshCw, School } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Props = { schoolId: string; adminId: string; schoolName: string; logoUrl: string | null; principalName: string };
type ClassRow = { id: string; name: string; arm: string | null };
type SessionRow = { id: string; name: string; is_current: boolean };
type TermRow = { id: string; term_name: string; status: string; session_id: string };
type Student = { id: string; full_name: string; admission_number: string; gender: string | null; date_of_birth: string | null };
type Subject = { id: string; name: string };
type ScoreRow = { student_id: string; subject_id: string; subject_name: string; ca_score: number; exam_score: number; subject_total: number; subject_grade: string | null; overall_total: number; average_score: number; class_position: number };
type CommentRow = { student_id: string; form_teacher_comment: string | null; conduct: Record<string, unknown> | null };
type PrincipalComment = { student_id: string; comment: string | null };
type AttendanceRow = { student_id: string; attendance_date: string; status: string };
type GradeBand = { grade: string; remark: string | null; min_score: number; max_score: number };
type ReportStudent = Student & { scores: Record<string, ScoreRow>; overall: number | null; average: number | null; position: number | null; formComment: string; principalComment: string; conduct: Record<string, unknown>; present: number; absent: number };

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 3).map((x) => x[0]).join("").toUpperCase() || "SCH";
const fmt = (n: number | null | undefined) => n == null || !Number.isFinite(Number(n)) ? "—" : Number(n).toFixed(Number(n) % 1 ? 2 : 0);
const ordinal = (n: number | null) => !n ? "—" : `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`;

export default function ReportCards({ schoolId, adminId, schoolName, logoUrl, principalName }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [terms, setTerms] = useState<TermRow[]>([]);
  const [classId, setClassId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [termId, setTermId] = useState("");
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [students, setStudents] = useState<ReportStudent[]>([]);
  const [bands, setBands] = useState<GradeBand[]>([]);
  const [formTeacher, setFormTeacher] = useState("Not assigned");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [schoolAddress, setSchoolAddress] = useState("");
  const [schoolPhone, setSchoolPhone] = useState("");
  const [schoolEmail, setSchoolEmail] = useState("");
  const [schoolPrincipal, setSchoolPrincipal] = useState(principalName);
  const [schoolSaving, setSchoolSaving] = useState(false);
  const [totalSchoolDays, setTotalSchoolDays] = useState(0);
  const [principalDraft, setPrincipalDraft] = useState("");
  const [savingPrincipal, setSavingPrincipal] = useState(false);
  const [principalNotice, setPrincipalNotice] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [c, s, t] = await Promise.all([
          supabase.from("classes").select("id,name,arm").eq("school_id", schoolId).order("level_order").order("name"),
          supabase.from("academic_sessions").select("id,name,is_current").eq("school_id", schoolId).order("name", { ascending: false }),
          supabase.from("academic_terms").select("id,term_name,status,session_id").eq("school_id", schoolId),
        ]);
        if (c.error) throw c.error; if (s.error) throw s.error; if (t.error) throw t.error;
        if (!alive) return;
        setClasses(c.data || []); setSessions(s.data || []); setTerms(t.data || []);
        const current = (s.data || []).find((x: SessionRow) => x.is_current) || (s.data || [])[0];
        if (current) { setSessionId(current.id); const open = (t.data || []).find((x: TermRow) => x.session_id === current.id && x.status === "open"); if (open) setTermId(open.id); }
        if ((c.data || [])[0]) setClassId((c.data || [])[0].id);
      } catch (e) { if (alive) setError(e instanceof Error ? e.message : "Unable to load report-card setup."); }
    })();
    return () => { alive = false; };
  }, [schoolId, supabase]);

  const loadReports = useCallback(async () => {
    if (!classId || !termId) { setStudents([]); return; }
    setLoading(true); setError("");
    try {
      const [studentRes, assignmentRes, sheetRes, commentsRes, principalRes, attendanceRes, formRes, scaleRes, schoolRes] = await Promise.all([
        supabase.from("students").select("id,full_name,admission_number,gender,date_of_birth").eq("school_id", schoolId).eq("class_id", classId).eq("is_active", true).order("full_name"),
        supabase.from("teacher_assignments").select("subject_id").eq("school_id", schoolId).eq("class_id", classId).not("subject_id", "is", null),
        supabase.rpc("get_class_broadsheet", { p_class_id: classId, p_term_id: termId }),
        supabase.from("student_comments").select("student_id,form_teacher_comment,conduct").eq("school_id", schoolId).eq("class_id", classId).eq("term_id", termId),
        supabase.from("principal_comments").select("student_id,comment").eq("school_id", schoolId).eq("class_id", classId).eq("term_id", termId),
        supabase.from("attendance").select("student_id,attendance_date,status").eq("school_id", schoolId).eq("class_id", classId).eq("term_id", termId),
        supabase.from("teacher_assignments").select("teacher_id").eq("school_id", schoolId).eq("class_id", classId).eq("is_form_teacher", true).maybeSingle(),
        supabase.from("grading_scales").select("id").eq("school_id", schoolId).eq("is_default", true).maybeSingle(),
        supabase.from("schools").select("name,logo_url,address,phone,email,principal_name").eq("id", schoolId).single(),
      ]);
      for (const r of [studentRes, assignmentRes, sheetRes, commentsRes, principalRes, attendanceRes, formRes, scaleRes, schoolRes]) if (r.error) throw r.error;
      const ids = [...new Set((assignmentRes.data || []).map((x: any) => x.subject_id).filter(Boolean))];
      const [subjectRes, teacherRes, bandRes] = await Promise.all([
        ids.length ? supabase.from("subjects").select("id,name").eq("school_id", schoolId).in("id", ids).order("name") : Promise.resolve({ data: [], error: null } as any),
        formRes.data?.teacher_id ? supabase.from("profiles").select("full_name").eq("school_id", schoolId).eq("id", formRes.data.teacher_id).maybeSingle() : Promise.resolve({ data: null, error: null } as any),
        scaleRes.data?.id ? supabase.from("grade_bands").select("grade,remark,min_score,max_score").eq("school_id", schoolId).eq("grading_scale_id", scaleRes.data.id).order("min_score") : Promise.resolve({ data: [], error: null } as any),
      ]);
      if (subjectRes.error) throw subjectRes.error; if (teacherRes.error) throw teacherRes.error; if (bandRes.error) throw bandRes.error;
      const scoreRows = (sheetRes.data || []) as ScoreRow[];
      const scoreMap = new Map<string, Record<string, ScoreRow>>();
      for (const row of scoreRows) { const map = scoreMap.get(row.student_id) || {}; map[row.subject_id] = row; scoreMap.set(row.student_id, map); }
      const comments = new Map((commentsRes.data || []).map((x: CommentRow) => [x.student_id, x]));
      const principals = new Map((principalRes.data || []).map((x: PrincipalComment) => [x.student_id, x.comment || ""]));
      const attendance = (attendanceRes.data || []) as AttendanceRow[];
      const built = ((studentRes.data || []) as Student[]).map((st) => {
        const rows = attendance.filter((a) => a.student_id === st.id);
        const summary = comments.get(st.id);
        const first = scoreRows.find((x) => x.student_id === st.id);
        return { ...st, scores: scoreMap.get(st.id) || {}, overall: first ? Number(first.overall_total) : null, average: first ? Number(first.average_score) : null, position: first ? Number(first.class_position) : null, formComment: summary?.form_teacher_comment || "", principalComment: principals.get(st.id) || "", conduct: (summary?.conduct || {}) as Record<string, unknown>, present: rows.filter((a) => ["present", "late"].includes(a.status)).length, absent: rows.filter((a) => a.status === "absent").length };
      });
      setSubjects((subjectRes.data || []) as Subject[]); setStudents(built); setBands((bandRes.data || []) as GradeBand[]); setFormTeacher(teacherRes.data?.full_name || "Not assigned");
      setSchoolAddress(schoolRes.data?.address || ""); setSchoolPhone(schoolRes.data?.phone || ""); setSchoolEmail(schoolRes.data?.email || ""); setSchoolPrincipal(schoolRes.data?.principal_name || principalName);
      setTotalSchoolDays(new Set(attendance.map((a) => a.attendance_date)).size);
      if (!selectedStudentId && built[0]) setSelectedStudentId(built[0].id);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to populate report cards."); }
    finally { setLoading(false); }
  }, [schoolId, classId, termId, supabase, selectedStudentId]);

  useEffect(() => { void loadReports(); }, [loadReports]);
  const selectedClass = classes.find((x) => x.id === classId);
  const selectedTerm = terms.find((x) => x.id === termId);
  const selectedSession = sessions.find((x) => x.id === sessionId);
  const currentStudent = students.find((x) => x.id === selectedStudentId) || students[0];
  const classDays = totalSchoolDays;
  const getRemark = (score: ScoreRow | undefined) => {
    if (!score) return "Outstanding";
    return bands.find((b) => Number(score.subject_total) >= Number(b.min_score) && (Number(score.subject_total) < Number(b.max_score) || Number(score.subject_total) === Number(b.max_score) && b === bands[bands.length - 1]))?.remark || "—";
  };
  useEffect(() => { setPrincipalDraft(currentStudent?.principalComment || ""); setPrincipalNotice(""); }, [currentStudent?.id, currentStudent?.principalComment]);
  const savePrincipalComment = async () => {
    if (!currentStudent || !classId || !termId) return;
    setSavingPrincipal(true); setPrincipalNotice(""); setError("");
    try {
      const { data: existing, error: findError } = await supabase.from("principal_comments").select("id").eq("school_id", schoolId).eq("student_id", currentStudent.id).eq("term_id", termId).maybeSingle();
      if (findError) throw findError;
      if (existing?.id) {
        const { error: updateError } = await supabase.from("principal_comments").update({ comment: principalDraft.trim() || null }).eq("id", existing.id).eq("school_id", schoolId);
        if (updateError) throw updateError;
      } else if (principalDraft.trim()) {
        const { error: insertError } = await supabase.from("principal_comments").insert({ school_id: schoolId, student_id: currentStudent.id, class_id: classId, term_id: termId, comment: principalDraft.trim(), entered_by: adminId });
        if (insertError) throw insertError;
      }
      setStudents((old) => old.map((s) => s.id === currentStudent.id ? { ...s, principalComment: principalDraft.trim() } : s));
      setPrincipalNotice("Principal's comment saved.");
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save principal's comment."); }
    finally { setSavingPrincipal(false); }
  };
  const saveSchoolDetails = async () => {
    setSchoolSaving(true); setError("");
    try {
      const { error: updateError } = await supabase.from("schools").update({ address: schoolAddress.trim() || null, phone: schoolPhone.trim() || null, email: schoolEmail.trim() || null, principal_name: schoolPrincipal.trim() || null }).eq("id", schoolId);
      if (updateError) throw updateError;
      setPrincipalNotice("School report-card details saved.");
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save school details. Confirm migration 003 has been applied."); }
    finally { setSchoolSaving(false); }
  };
  const printReport = () => { if (!currentStudent) return; window.print(); };

  return <section className="space-y-5">
    <style jsx global>{`@media print { body * { visibility:hidden !important; } #klasrum-report-print, #klasrum-report-print * { visibility:visible !important; } #klasrum-report-print { position:absolute; inset:0; width:100%; margin:0; padding:12mm; background:#fff; } .no-print { display:none !important; } .report-page { page-break-after:always; break-after:page; } @page { size:A4 portrait; margin:0; } }`}</style>
    <div className="card p-5 no-print"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-black">Terminal report cards</h2><p className="text-sm text-slate-500 mt-1">Automatically populated from My Teaching scores, the class broadsheet and saved comments.</p></div><button className="btn btn-light" onClick={() => void loadReports()} disabled={loading}><RefreshCw size={15} className={loading ? "animate-spin" : ""}/> Refresh data</button></div>
      <div className="grid sm:grid-cols-3 gap-3 mt-4"><div><label className="label">Class</label><select className="field" value={classId} onChange={(e) => setClassId(e.target.value)}>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}{c.arm ? ` ${c.arm}` : ""}</option>)}</select></div><div><label className="label">Academic session</label><select className="field" value={sessionId} onChange={(e) => { setSessionId(e.target.value); setTermId(terms.find((t) => t.session_id === e.target.value)?.id || ""); }}>{sessions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div><div><label className="label">Term</label><select className="field" value={termId} onChange={(e) => setTermId(e.target.value)}>{terms.filter((t) => t.session_id === sessionId).map((t) => <option key={t.id} value={t.id}>{t.term_name} · {t.status}</option>)}</select></div></div>
      {error && <div className="mt-4 p-3 rounded-xl bg-rose-50 text-rose-700 text-sm flex gap-2"><AlertCircle size={16}/>{error}</div>}
      <div className="mt-4 flex flex-wrap items-center gap-2"><span className="text-xs text-slate-500">{students.length} active students · {subjects.length} subjects · Form teacher: {formTeacher}</span><span className="ml-auto"/><button className="btn btn-primary" onClick={printReport} disabled={!currentStudent}><Printer size={15}/> Print / Save selected PDF</button></div>
      <div className="mt-4 border-t border-slate-100 pt-4"><h4 className="font-semibold text-sm">School details printed on the report card</h4><div className="grid sm:grid-cols-2 gap-3 mt-3"><div><label className="label">School address</label><input className="field" value={schoolAddress} onChange={(e) => setSchoolAddress(e.target.value)} placeholder="School address"/></div><div><label className="label">School phone</label><input className="field" value={schoolPhone} onChange={(e) => setSchoolPhone(e.target.value)} placeholder="Phone number"/></div><div><label className="label">School email</label><input className="field" type="email" value={schoolEmail} onChange={(e) => setSchoolEmail(e.target.value)} placeholder="School email"/></div><div><label className="label">Principal's name</label><input className="field" value={schoolPrincipal} onChange={(e) => setSchoolPrincipal(e.target.value)} placeholder="Principal / Head of School"/></div></div><button className="btn btn-light mt-3" onClick={() => void saveSchoolDetails()} disabled={schoolSaving}>{schoolSaving ? "Saving..." : "Save school details"}</button></div>
      {currentStudent && <div className="mt-4 grid sm:grid-cols-[1fr_auto] gap-2 items-end"><div><label className="label">Principal's comment for {currentStudent.full_name}</label><textarea className="field min-h-20" maxLength={1000} value={principalDraft} onChange={(e) => setPrincipalDraft(e.target.value)} placeholder="Enter principal's comment" /></div><button className="btn btn-light" onClick={() => void savePrincipalComment()} disabled={savingPrincipal}>{savingPrincipal ? "Saving..." : "Save principal comment"}</button></div>}
      {principalNotice && <p className="text-xs text-emerald-700 mt-2">{principalNotice}</p>}
      <div className="mt-4 flex flex-wrap gap-2">{students.map((s) => <button key={s.id} onClick={() => setSelectedStudentId(s.id)} className={`px-3 py-2 rounded-lg text-xs border ${currentStudent?.id === s.id ? "bg-blue-50 border-blue-300 text-blue-800 font-bold" : "border-slate-200 text-slate-600"}`}>{s.full_name}</button>)}</div>
      {selectedTerm && selectedTerm.status !== "published" && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">Preview only: this term is {selectedTerm.status}. Final publication and immutable report snapshots are a separate step.</p>}
    </div>
    {loading ? <div className="card p-10 text-center text-sm text-slate-500">Compiling report-card data...</div> : !currentStudent ? <div className="card p-10 text-center"><FileText className="mx-auto text-slate-300" size={30}/><p className="mt-3 font-semibold">No active students found for this class and term.</p></div> : <div id="klasrum-report-print" className="bg-white border border-slate-200 shadow-sm rounded-xl p-5 md:p-8 max-w-[900px] mx-auto text-slate-900 report-page">
      <header className="text-center border-b-2 border-slate-800 pb-4"><div className="flex items-center justify-center gap-4">{logoUrl ? <img src={logoUrl} alt="School logo" className="w-16 h-16 object-contain"/> : <div className="w-16 h-16 rounded-full border-2 border-slate-700 grid place-items-center font-black text-lg">{initials(schoolName)}</div>}<div><h1 className="text-2xl font-black uppercase tracking-wide">{schoolName}</h1><p className="text-xs mt-1">{schoolAddress || "School address not yet configured"}{schoolPhone ? ` · ${schoolPhone}` : ""}{schoolEmail ? ` · ${schoolEmail}` : ""}</p><p className="text-sm font-bold mt-2 tracking-[.2em]">STUDENT TERMINAL REPORT</p></div></div></header>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-5 gap-y-2 text-xs border-b border-slate-300 py-4"><div><b>Student:</b> {currentStudent.full_name}</div><div><b>Admission No:</b> {currentStudent.admission_number}</div><div><b>Class:</b> {selectedClass?.name} {selectedClass?.arm}</div><div><b>Gender:</b> {currentStudent.gender || "—"}</div><div><b>Session:</b> {selectedSession?.name || "—"}</div><div><b>Term:</b> {selectedTerm?.term_name || "—"}</div><div><b>Form Teacher:</b> {formTeacher}</div><div><b>Class Size:</b> {students.length}</div></div>
      <h3 className="font-bold text-sm mt-4 mb-2">Academic Performance</h3><table className="w-full text-xs border-collapse"><thead><tr className="bg-slate-100"><th className="border border-slate-400 p-2 text-left">Subject</th><th className="border border-slate-400 p-2">CA</th><th className="border border-slate-400 p-2">Exam</th><th className="border border-slate-400 p-2">Total</th><th className="border border-slate-400 p-2">Grade</th><th className="border border-slate-400 p-2">Remark</th></tr></thead><tbody>{subjects.map((sub) => { const sc = currentStudent.scores[sub.id]; return <tr key={sub.id}><td className="border border-slate-400 p-2">{sub.name}</td><td className="border border-slate-400 p-2 text-center">{sc ? fmt(Number(sc.ca_score)) : "—"}</td><td className="border border-slate-400 p-2 text-center">{sc ? fmt(Number(sc.exam_score)) : "—"}</td><td className="border border-slate-400 p-2 text-center font-bold">{sc ? fmt(Number(sc.subject_total)) : "—"}</td><td className="border border-slate-400 p-2 text-center">{sc?.subject_grade || "—"}</td><td className="border border-slate-400 p-2">{getRemark(sc)}</td></tr>; })}</tbody></table>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 text-xs"><div className="border border-slate-400 p-2"><b>Aggregate Total</b><div className="text-lg font-black">{fmt(currentStudent.overall)}</div></div><div className="border border-slate-400 p-2"><b>Average</b><div className="text-lg font-black">{fmt(currentStudent.average)}%</div></div><div className="border border-slate-400 p-2"><b>Class Position</b><div className="text-lg font-black">{ordinal(currentStudent.position)}</div></div><div className="border border-slate-400 p-2"><b>Subjects Offered</b><div className="text-lg font-black">{subjects.length}</div></div></div>
      <div className="grid sm:grid-cols-2 gap-4 mt-4 text-xs"><div className="border border-slate-300 p-3"><b>Attendance</b><div className="grid grid-cols-3 gap-2 mt-2"><span>School days: {classDays || "—"}</span><span>Present: {currentStudent.present}</span><span>Absent: {currentStudent.absent}</span></div></div><div className="border border-slate-300 p-3"><b>Affective / Psychomotor Traits</b><div className="grid grid-cols-2 gap-1 mt-2">{Object.entries(currentStudent.conduct || {}).length ? Object.entries(currentStudent.conduct).map(([k,v]) => <span key={k}>{k.replaceAll("_", " ")}: <b>{String(v)}</b></span>) : <span className="text-slate-500">Not yet assessed</span>}</div></div></div>
      <div className="mt-4 grid sm:grid-cols-2 gap-4 text-xs"><div className="border border-slate-300 p-3 min-h-20"><b>Form Teacher's Comment</b><p className="mt-2 whitespace-pre-wrap">{currentStudent.formComment || "No form-teacher comment recorded."}</p><p className="mt-4">Name: {formTeacher}</p></div><div className="border border-slate-300 p-3 min-h-20"><b>Principal's Comment</b><p className="mt-2 whitespace-pre-wrap">{currentStudent.principalComment || "No principal's comment recorded."}</p><p className="mt-4">Name: {schoolPrincipal || principalName || "School Administrator"}</p></div></div>
      <div className="grid grid-cols-2 gap-10 mt-8 text-xs"><div className="border-t border-slate-500 pt-2">Form Teacher's Signature</div><div className="border-t border-slate-500 pt-2">Principal's Signature / School Stamp</div></div><p className="text-[10px] text-center text-slate-500 mt-6">Generated by Klasrum · {new Date().toLocaleDateString()}</p>
    </div>}
    <div className="no-print text-xs text-slate-500 text-center">Use your browser's print dialog and choose “Save as PDF”. Each selected student's report card is formatted for A4 printing.</div>
  </section>;
}
