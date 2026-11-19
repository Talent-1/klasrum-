"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BookOpen, Users, RefreshCw, AlertCircle, GraduationCap, ClipboardList,
  Save, CheckCircle2, ChevronDown, FileText, LockKeyhole,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Props = { schoolId: string; teacherId: string };
type Assignment = { id: string; class_id: string; subject_id: string | null; is_form_teacher: boolean };
type ClassRow = { id: string; name: string; arm: string | null; level_order: number | null };
type SubjectRow = { id: string; name: string; short_code: string | null };
type StudentRow = { id: string; class_id: string; admission_number: string; full_name: string; gender: string | null; is_active: boolean };
type AcademicTerm = { id: string; term_name: string; status: string; session_id: string };
type GradingScale = { id: string; name: string; ca_max: number; exam_max: number; is_default: boolean };
type ExistingScore = { id: string; student_id: string; ca_score: number; exam_score: number };
type TeachingClass = { classInfo: ClassRow; assignments: Assignment[]; subjects: SubjectRow[]; isFormTeacher: boolean; students: StudentRow[] };
type ScoreDraft = { ca: string; exam: string; reason: string };

const classLabel = (item: ClassRow) => `${item.name}${item.arm ? ` ${item.arm}` : ""}`;
const numericValue = (value: string) => value.trim() === "" ? null : Number(value);

export default function TeacherWorkspace({ schoolId, teacherId }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [classes, setClasses] = useState<TeachingClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");

  const [selectedClassId, setSelectedClassId] = useState("");
  const [selectedSubjectId, setSelectedSubjectId] = useState("");
  const [terms, setTerms] = useState<AcademicTerm[]>([]);
  const [selectedTermId, setSelectedTermId] = useState("");
  const [gradingScale, setGradingScale] = useState<GradingScale | null>(null);
  const [academicLoading, setAcademicLoading] = useState(false);
  const [academicError, setAcademicError] = useState("");

  const [existingScores, setExistingScores] = useState<Record<string, ExistingScore>>({});
  const [drafts, setDrafts] = useState<Record<string, ScoreDraft>>({});
  const [scoresLoading, setScoresLoading] = useState(false);
  const [savingStudentId, setSavingStudentId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const { data: assignmentRows, error: assignmentError } = await supabase
        .from("teacher_assignments")
        .select("id,class_id,subject_id,is_form_teacher")
        .eq("school_id", schoolId)
        .eq("teacher_id", teacherId);
      if (assignmentError) throw assignmentError;

      const assignments = (assignmentRows || []) as Assignment[];
      const classIds = [...new Set(assignments.map((item) => item.class_id))];
      if (!classIds.length) { setClasses([]); setSelectedClassId(""); return; }

      const subjectIds = [...new Set(assignments.map((item) => item.subject_id).filter((id): id is string => Boolean(id)))];
      const [classResult, subjectResult, studentResult] = await Promise.all([
        supabase.from("classes").select("id,name,arm,level_order").eq("school_id", schoolId).in("id", classIds),
        subjectIds.length
          ? supabase.from("subjects").select("id,name,short_code").eq("school_id", schoolId).in("id", subjectIds).eq("is_active", true)
          : Promise.resolve({ data: [], error: null }),
        supabase.from("students").select("id,class_id,admission_number,full_name,gender,is_active")
          .eq("school_id", schoolId).in("class_id", classIds).eq("is_active", true).order("full_name", { ascending: true }),
      ]);
      if (classResult.error) throw classResult.error;
      if (subjectResult.error) throw subjectResult.error;
      if (studentResult.error) throw studentResult.error;

      const classRows = (classResult.data || []) as ClassRow[];
      const subjectRows = (subjectResult.data || []) as SubjectRow[];
      const studentRows = (studentResult.data || []) as StudentRow[];
      const nextClasses = classRows.map((classInfo) => {
        const ownAssignments = assignments.filter((item) => item.class_id === classInfo.id);
        const ids = ownAssignments.map((item) => item.subject_id).filter((id): id is string => Boolean(id));
        return {
          classInfo,
          assignments: ownAssignments,
          subjects: subjectRows.filter((subject) => ids.includes(subject.id)),
          isFormTeacher: ownAssignments.some((item) => item.is_form_teacher),
          students: studentRows.filter((student) => student.class_id === classInfo.id),
        };
      }).sort((a, b) => (a.classInfo.level_order ?? 999) - (b.classInfo.level_order ?? 999) || a.classInfo.name.localeCompare(b.classInfo.name));

      setClasses(nextClasses);
      setSelectedClassId((current) => nextClasses.some((item) => item.classInfo.id === current) ? current : nextClasses[0]?.classInfo.id || "");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to load your teaching assignments.");
    } finally { setLoading(false); }
  }, [schoolId, teacherId, supabase]);

  useEffect(() => { void load(); }, [load]);

  const loadAcademicContext = useCallback(async () => {
    setAcademicLoading(true); setAcademicError(""); setNotice("");
    try {
      const [sessionResult, scaleResult] = await Promise.all([
        supabase.from("academic_sessions").select("id,name,is_current").eq("school_id", schoolId).eq("is_current", true).maybeSingle(),
        supabase.from("grading_scales").select("id,name,ca_max,exam_max,is_default").eq("school_id", schoolId).eq("is_default", true).maybeSingle(),
      ]);
      if (sessionResult.error) throw sessionResult.error;
      if (scaleResult.error) throw scaleResult.error;
      if (!sessionResult.data) throw new Error("Your school has not selected a current academic session yet.");
      if (!scaleResult.data) throw new Error("Your school has not configured a default grading scale. Please contact the administrator.");

      const { data: termRows, error: termError } = await supabase.from("academic_terms")
        .select("id,term_name,status,session_id")
        .eq("school_id", schoolId)
        .eq("session_id", sessionResult.data.id)
        .order("term_name", { ascending: true });
      if (termError) throw termError;
      const availableTerms = (termRows || []) as AcademicTerm[];
      setTerms(availableTerms);
      setGradingScale(scaleResult.data as GradingScale);
      const openTerm = availableTerms.find((term) => term.status === "open");
      setSelectedTermId((current) => availableTerms.some((term) => term.id === current && term.status === "open") ? current : openTerm?.id || "");
      if (!openTerm && !availableTerms.some((term) => term.status === "open")) {
        setAcademicError("There is no open term in the current academic session. Score entry becomes available when the administrator opens a term.");
      }
    } catch (err: unknown) {
      setAcademicError(err instanceof Error ? err.message : "Unable to load the current academic session and grading configuration.");
      setTerms([]); setSelectedTermId(""); setGradingScale(null);
    } finally { setAcademicLoading(false); }
  }, [schoolId, supabase]);

  useEffect(() => { void loadAcademicContext(); }, [loadAcademicContext]);

  const selectedClass = classes.find((item) => item.classInfo.id === selectedClassId) || null;
  const availableSubjects = selectedClass?.subjects || [];
  const selectedSubject = availableSubjects.find((subject) => subject.id === selectedSubjectId) || null;
  const selectedTerm = terms.find((term) => term.id === selectedTermId) || null;
  const scoreEntryOpen = selectedTerm?.status === "open" && Boolean(gradingScale);

  useEffect(() => {
    if (!availableSubjects.some((subject) => subject.id === selectedSubjectId)) {
      setSelectedSubjectId(availableSubjects[0]?.id || "");
    }
  }, [selectedClassId, availableSubjects, selectedSubjectId]);

  const loadScores = useCallback(async () => {
    if (!selectedClassId || !selectedSubjectId || !selectedTermId || !selectedClass) {
      setExistingScores({}); setDrafts({}); return;
    }
    setScoresLoading(true); setError(""); setNotice("");
    try {
      const { data, error: scoreError } = await supabase.from("scores")
        .select("id,student_id,ca_score,exam_score")
        .eq("school_id", schoolId)
        .eq("class_id", selectedClassId)
        .eq("subject_id", selectedSubjectId)
        .eq("term_id", selectedTermId);
      if (scoreError) throw scoreError;
      const map: Record<string, ExistingScore> = {};
      const nextDrafts: Record<string, ScoreDraft> = {};
      ((data || []) as ExistingScore[]).forEach((score) => {
        map[score.student_id] = score;
        nextDrafts[score.student_id] = { ca: String(score.ca_score), exam: String(score.exam_score), reason: "" };
      });
      selectedClass.students.forEach((student) => {
        if (!nextDrafts[student.id]) nextDrafts[student.id] = { ca: "", exam: "", reason: "" };
      });
      setExistingScores(map); setDrafts(nextDrafts);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to retrieve previously saved scores.");
      setExistingScores({}); setDrafts({});
    } finally { setScoresLoading(false); }
  }, [schoolId, selectedClassId, selectedSubjectId, selectedTermId, selectedClass, supabase]);

  useEffect(() => { void loadScores(); }, [loadScores]);

  const updateDraft = (studentId: string, field: keyof ScoreDraft, value: string) => {
    setDrafts((current) => ({ ...current, [studentId]: { ...(current[studentId] || { ca: "", exam: "", reason: "" }), [field]: value } }));
    setNotice("");
  };

  const saveStudentScore = async (student: StudentRow) => {
    if (!selectedSubject || !selectedTerm || !gradingScale || !scoreEntryOpen) return;
    const draft = drafts[student.id] || { ca: "", exam: "", reason: "" };
    const ca = numericValue(draft.ca);
    const exam = numericValue(draft.exam);
    if (ca === null || exam === null || !Number.isFinite(ca) || !Number.isFinite(exam)) {
      setError(`Enter both CA and examination scores for ${student.full_name}.`); return;
    }
    if (ca < 0 || ca > Number(gradingScale.ca_max)) {
      setError(`The CA score for ${student.full_name} must be between 0 and ${gradingScale.ca_max}, according to the school's grading configuration.`); return;
    }
    if (exam < 0 || exam > Number(gradingScale.exam_max)) {
      setError(`The examination score for ${student.full_name} must be between 0 and ${gradingScale.exam_max}, according to the school's grading configuration.`); return;
    }
    const existing = existingScores[student.id];
    const changed = Boolean(existing && (Number(existing.ca_score) !== ca || Number(existing.exam_score) !== exam));
    if (existing && !changed) { setNotice(`No changes to save for ${student.full_name}.`); setError(""); return; }
    if (changed && !draft.reason.trim()) {
      setError(`Please provide a correction reason for ${student.full_name} before saving the revised scores.`); return;
    }

    setSavingStudentId(student.id); setError(""); setNotice("");
    try {
      const { error: rpcError } = await supabase.rpc("save_subject_score", {
        p_student_id: student.id,
        p_subject_id: selectedSubject.id,
        p_term_id: selectedTerm.id,
        p_ca_score: ca,
        p_exam_score: exam,
        p_reason: changed ? draft.reason.trim() : null,
      });
      if (rpcError) throw rpcError;
      await loadScores();
      setNotice(`Scores saved successfully for ${student.full_name}. The system retains the assessment scores and calculates the total.`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : `Unable to save scores for ${student.full_name}.`);
    } finally { setSavingStudentId(null); }
  };

  const filtered = classes.filter((item) => {
    const term = query.trim().toLowerCase();
    if (!term) return true;
    return `${classLabel(item.classInfo)} ${item.subjects.map((s) => s.name).join(" ")}`.toLowerCase().includes(term);
  });
  const totalStudents = classes.reduce((sum, item) => sum + item.students.length, 0);
  const subjectCount = new Set(classes.flatMap((item) => item.subjects.map((s) => s.id))).size;
  const formTeacherCount = classes.filter((item) => item.isFormTeacher).length;
  const savedCount = Object.keys(existingScores).length;
  const formatMax = (value: number) => Number.isInteger(Number(value)) ? String(value) : Number(value).toFixed(2);

  return <section className="space-y-5">
    <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
      <div className="card p-4"><div className="flex items-center justify-between"><p className="text-xs text-slate-500">My classes</p><BookOpen className="text-[#3157d5]" size={19}/></div><p className="text-2xl font-black mt-2">{classes.length}</p></div>
      <div className="card p-4"><div className="flex items-center justify-between"><p className="text-xs text-slate-500">My subjects</p><GraduationCap className="text-[#3157d5]" size={19}/></div><p className="text-2xl font-black mt-2">{subjectCount}</p></div>
      <div className="card p-4 col-span-2 xl:col-span-1"><div className="flex items-center justify-between"><p className="text-xs text-slate-500">Assigned students</p><Users className="text-[#3157d5]" size={19}/></div><p className="text-2xl font-black mt-2">{totalStudents}</p><p className="text-xs text-slate-400 mt-1">{formTeacherCount} form-teacher assignment(s)</p></div>
    </div>

    <div className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div><h3 className="font-bold text-lg">My teaching assignments</h3><p className="text-xs text-slate-400 mt-1">Your assigned classes and subjects, with score entry for each subject assignment.</p></div>
        <button className="btn btn-light" onClick={() => { void load(); void loadAcademicContext(); }} disabled={loading || academicLoading}><RefreshCw size={15} className={loading || academicLoading ? "animate-spin" : ""}/> Refresh</button>
      </div>
      <input className="field mb-4" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search my classes or subjects..." />
      {error && <div className="p-3 mb-3 rounded-xl bg-rose-50 text-rose-700 text-sm flex gap-2 items-start"><AlertCircle size={17} className="shrink-0 mt-0.5"/><span>{error}</span></div>}
      {notice && <div className="p-3 mb-3 rounded-xl bg-emerald-50 text-emerald-700 text-sm flex gap-2 items-start"><CheckCircle2 size={17} className="shrink-0 mt-0.5"/><span>{notice}</span></div>}
      {loading ? <div className="py-10 text-center text-sm text-slate-400">Loading your assignments...</div> : filtered.length === 0 ?
        <div className="py-10 text-center border border-dashed border-slate-200 rounded-2xl"><ClipboardList className="mx-auto text-slate-300" size={30}/><h4 className="font-bold mt-3">{classes.length ? "No matching assignments" : "No teaching assignments yet"}</h4><p className="text-sm text-slate-500 mt-1">{classes.length ? "Try another search." : "Ask your school administrator to assign your classes and subjects in Klasrum."}</p></div> :
        <div className="grid xl:grid-cols-2 gap-4">{filtered.map((item) => <article key={item.classInfo.id} className="rounded-2xl border border-slate-200 p-4">
          <div className="flex items-start justify-between gap-3"><div><h4 className="font-bold text-base">{classLabel(item.classInfo)}</h4><p className="text-xs text-slate-400 mt-1">{item.students.length} active student(s)</p></div>{item.isFormTeacher && <span className="pill bg-violet-50 text-violet-700">Form teacher</span>}</div>
          <div className="mt-4"><p className="text-xs font-semibold text-slate-500 mb-2">Assigned subjects</p>{item.subjects.length ? <div className="flex flex-wrap gap-2">{item.subjects.map((subject) => <button key={subject.id} type="button" onClick={() => { setSelectedClassId(item.classInfo.id); setSelectedSubjectId(subject.id); document.getElementById("teacher-score-entry")?.scrollIntoView({ behavior: "smooth", block: "start" }); }} className={`pill border ${selectedClassId === item.classInfo.id && selectedSubjectId === subject.id ? "bg-blue-100 text-blue-800 border-blue-200" : "bg-blue-50 text-blue-700 border-transparent"}`}>{subject.name}{subject.short_code ? ` · ${subject.short_code}` : ""}</button>)}</div> : <p className="text-sm text-slate-400">No subject assignments for this class.</p>}</div>
          <div className="mt-4 border-t border-slate-100 pt-3"><p className="text-xs font-semibold text-slate-500 mb-2">Students in this class</p>{item.students.length ? <div className="max-h-40 overflow-y-auto divide-y divide-slate-100">{item.students.map((student) => <div key={student.id} className="py-2 flex items-center justify-between gap-3"><div className="min-w-0"><p className="text-sm font-medium truncate">{student.full_name}</p><p className="text-xs text-slate-400">{student.admission_number}</p></div><span className="text-xs text-slate-400">{student.gender || "—"}</span></div>)}</div> : <p className="text-sm text-slate-400">No active students are registered in this class.</p>}</div>
        </article>)}</div>}
    </div>

    <div id="teacher-score-entry" className="card p-5 scroll-mt-24">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><div className="flex items-center gap-2"><FileText size={19} className="text-[#3157d5]"/><h3 className="font-bold text-lg">Subject score entry</h3></div><p className="text-xs text-slate-500 mt-1">Enter CA and examination marks only. Klasrum calculates the subject total automatically.</p></div>
        <button className="btn btn-light" onClick={() => void loadScores()} disabled={scoresLoading || !selectedSubjectId || !selectedTermId}><RefreshCw size={15} className={scoresLoading ? "animate-spin" : ""}/> Reload scores</button>
      </div>

      <div className="grid sm:grid-cols-3 gap-3 mt-5">
        <div><label className="label">Assigned class</label><select className="field" value={selectedClassId} onChange={(e) => { setSelectedClassId(e.target.value); setSelectedSubjectId(""); }}><option value="">Select class</option>{classes.map((item) => <option key={item.classInfo.id} value={item.classInfo.id}>{classLabel(item.classInfo)}</option>)}</select></div>
        <div><label className="label">Assigned subject</label><select className="field" value={selectedSubjectId} onChange={(e) => setSelectedSubjectId(e.target.value)} disabled={!availableSubjects.length}><option value="">Select subject</option>{availableSubjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></div>
        <div><label className="label">Current term</label><select className="field" value={selectedTermId} onChange={(e) => setSelectedTermId(e.target.value)} disabled={!terms.some((term) => term.status === "open")}><option value="">Select open term</option>{terms.filter((term) => term.status === "open").map((term) => <option key={term.id} value={term.id}>{term.term_name}</option>)}</select></div>
      </div>

      {academicLoading && <p className="text-sm text-slate-500 mt-4">Loading current session and grading configuration...</p>}
      {academicError && <div className="mt-4 p-3 rounded-xl bg-amber-50 text-amber-800 text-sm flex gap-2"><AlertCircle size={17} className="shrink-0"/>{academicError}</div>}
      {gradingScale && <div className="mt-4 rounded-xl bg-blue-50 border border-blue-100 p-3 text-sm text-blue-900"><strong>{gradingScale.name}</strong> · CA maximum: {formatMax(gradingScale.ca_max)} · Examination maximum: {formatMax(gradingScale.exam_max)}. These limits come from your school's administrator-configured grading scale.</div>}
      {!selectedClass && <div className="py-10 text-center text-sm text-slate-500">Select one of your assigned classes to begin.</div>}
      {selectedClass && !availableSubjects.length && <div className="py-8 text-center text-sm text-slate-500">You have no subject assignment for this class. Form-teacher assignments alone do not permit subject score entry.</div>}
      {selectedClass && selectedSubject && !selectedTerm && !academicLoading && !academicError && <div className="py-8 text-center text-sm text-slate-500">Select an open term to enter scores.</div>}
      {selectedClass && selectedSubject && selectedTerm && gradingScale && <>
        <div className="flex flex-wrap items-center justify-between gap-2 mt-5 mb-3"><div><h4 className="font-semibold">{classLabel(selectedClass.classInfo)} · {selectedSubject.name}</h4><p className="text-xs text-slate-500">{selectedTerm.term_name} · {savedCount} of {selectedClass.students.length} students have saved scores for this subject.</p></div><span className={`pill ${scoreEntryOpen ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{scoreEntryOpen ? "Score entry open" : "Read only"}</span></div>
        {!scoreEntryOpen && <div className="mb-3 p-3 rounded-xl bg-slate-100 text-slate-600 text-sm flex gap-2"><LockKeyhole size={17}/>This term is not open. Scores cannot be submitted or corrected.</div>}
        {scoresLoading ? <div className="py-10 text-center text-sm text-slate-400">Loading saved scores...</div> : selectedClass.students.length === 0 ? <div className="py-8 text-center text-sm text-slate-500">There are no active students in this class.</div> :
          <div className="overflow-x-auto -mx-1">
            <table className="table w-full min-w-[760px]">
              <thead><tr><th>Student name</th><th>Student ID / Admission no.</th><th>CA score ({formatMax(gradingScale.ca_max)} max)</th><th>Examination score ({formatMax(gradingScale.exam_max)} max)</th><th>Action</th></tr></thead>
              <tbody>{selectedClass.students.map((student) => {
                const draft = drafts[student.id] || { ca: "", exam: "", reason: "" };
                const existing = existingScores[student.id];
                const isChanged = Boolean(existing && (Number(existing.ca_score) !== numericValue(draft.ca) || Number(existing.exam_score) !== numericValue(draft.exam)));
                return <tr key={student.id}>
                  <td className="font-semibold">{student.full_name}</td>
                  <td className="text-slate-500">{student.admission_number}</td>
                  <td><input aria-label={`CA score for ${student.full_name}`} className="field !w-28 !py-2" type="number" inputMode="decimal" min="0" max={gradingScale.ca_max} step="0.01" value={draft.ca} disabled={!scoreEntryOpen || savingStudentId === student.id} onChange={(e) => updateDraft(student.id, "ca", e.target.value)} placeholder="CA" /></td>
                  <td><input aria-label={`Examination score for ${student.full_name}`} className="field !w-32 !py-2" type="number" inputMode="decimal" min="0" max={gradingScale.exam_max} step="0.01" value={draft.exam} disabled={!scoreEntryOpen || savingStudentId === student.id} onChange={(e) => updateDraft(student.id, "exam", e.target.value)} placeholder="Exam" /></td>
                  <td><button type="button" className="btn btn-primary !py-2 !px-3" disabled={!scoreEntryOpen || savingStudentId === student.id || !draft.ca.trim() || !draft.exam.trim() || (Boolean(existing) && !isChanged)} onClick={() => void saveStudentScore(student)}>{savingStudentId === student.id ? "Saving..." : existing ? <><Save size={14}/> Save correction</> : <><Save size={14}/> Save scores</>}</button></td>
                </tr>;
              })}</tbody>
            </table>
          </div>}
        {selectedClass.students.some((student) => {
          const existing = existingScores[student.id]; const draft = drafts[student.id];
          return existing && draft && (Number(existing.ca_score) !== numericValue(draft.ca) || Number(existing.exam_score) !== numericValue(draft.exam));
        }) && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4"><h5 className="font-semibold text-sm text-amber-900">Score correction reasons</h5><p className="text-xs text-amber-800 mt-1">A reason is required for every correction to an already saved score. Enter the reason against the affected student before saving.</p><div className="space-y-3 mt-3">{selectedClass.students.filter((student) => {
          const existing = existingScores[student.id]; const draft = drafts[student.id];
          return existing && draft && (Number(existing.ca_score) !== numericValue(draft.ca) || Number(existing.exam_score) !== numericValue(draft.exam));
        }).map((student) => <div key={student.id}><label className="label">{student.full_name} · {student.admission_number}</label><input className="field" value={drafts[student.id]?.reason || ""} onChange={(e) => updateDraft(student.id, "reason", e.target.value)} placeholder="Explain why these scores are being corrected" disabled={savingStudentId === student.id}/></div>)}</div></div>}
        <p className="text-xs text-slate-400 mt-4">Only CA and examination marks are entered here. No total field is provided; totals and grades are calculated by the existing Klasrum database result engine and remain available to the class broadsheet and report card.</p>
      </>}
    </div>
  </section>;
}
