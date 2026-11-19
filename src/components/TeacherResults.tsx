"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, BookOpen, RefreshCw, Save, Trophy } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Props = { schoolId: string; teacherId: string };
type FormAssignment = { class_id: string };
type ClassRow = { id: string; name: string; arm: string | null; level_order: number | null };
type TermRow = { id: string; term_name: string; status: string; session_id: string };
type SubjectRow = { id: string; name: string; short_code: string | null };
type StudentRow = { id: string; full_name: string; admission_number: string };
type BroadsheetRow = {
  student_id: string; admission_number: string; student_name: string;
  subject_id: string; subject_name: string; ca_score: number; exam_score: number;
  subject_total: number; subject_grade: string | null; overall_total: number;
  average_score: number; class_position: number;
};
type CommentRow = { student_id: string; form_teacher_comment: string | null };
type DisplayStudent = StudentRow & {
  scores: Record<string, BroadsheetRow>;
  total: number | null; average: number | null; position: number | null; comment: string;
};

export default function TeacherResults({ schoolId, teacherId }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [terms, setTerms] = useState<TermRow[]>([]);
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [students, setStudents] = useState<DisplayStudent[]>([]);
  const [classId, setClassId] = useState("");
  const [termId, setTermId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dirty, setDirty] = useState(false);

  const loadSetup = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const { data: assignments, error: assignmentError } = await supabase
        .from("teacher_assignments").select("class_id")
        .eq("school_id", schoolId).eq("teacher_id", teacherId).eq("is_form_teacher", true);
      if (assignmentError) throw assignmentError;
      const classIds = [...new Set((assignments || []).map((x: FormAssignment) => x.class_id))];
      if (!classIds.length) { setClasses([]); setTerms([]); setSubjects([]); setStudents([]); return; }
      const [classResult, sessionResult] = await Promise.all([
        supabase.from("classes").select("id,name,arm,level_order").eq("school_id", schoolId).in("id", classIds)
          .order("level_order", { ascending: true, nullsFirst: false }).order("name"),
        supabase.from("academic_sessions").select("id").eq("school_id", schoolId).eq("is_current", true).maybeSingle(),
      ]);
      if (classResult.error) throw classResult.error;
      if (sessionResult.error) throw sessionResult.error;
      const classRows = (classResult.data || []) as ClassRow[];
      setClasses(classRows);
      if (!classId && classRows[0]) setClassId(classRows[0].id);
      if (sessionResult.data?.id) {
        const { data: termRows, error: termError } = await supabase.from("academic_terms")
          .select("id,term_name,status,session_id").eq("school_id", schoolId)
          .eq("session_id", sessionResult.data.id).order("term_name");
        if (termError) throw termError;
        setTerms((termRows || []) as TermRow[]);
        const activeTerm = (termRows || []).find((t: TermRow) => t.status === "open");
        if (!termId && activeTerm) setTermId(activeTerm.id);
      } else setTerms([]);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to load form-teacher classes."); }
    finally { setLoading(false); }
  }, [schoolId, teacherId, supabase, classId, termId]);

  useEffect(() => { void loadSetup(); }, [loadSetup]);

  const loadBroadsheet = useCallback(async () => {
    if (!classId || !termId) { setStudents([]); setSubjects([]); return; }
    setLoading(true); setError(""); setNotice(""); setDirty(false);
    try {
      const [studentResult, sheetResult, commentResult] = await Promise.all([
        supabase.from("students").select("id,full_name,admission_number").eq("school_id", schoolId).eq("class_id", classId).eq("is_active", true).order("full_name"),
        supabase.rpc("get_class_broadsheet", { p_class_id: classId, p_term_id: termId }),
        supabase.from("student_comments").select("student_id,form_teacher_comment").eq("school_id", schoolId).eq("class_id", classId).eq("term_id", termId),
      ]);
      if (studentResult.error) throw studentResult.error;
      if (sheetResult.error) throw sheetResult.error;
      if (commentResult.error) throw commentResult.error;
      const scoreRows = (sheetResult.data || []) as BroadsheetRow[];
      const subjectMap = new Map<string, SubjectRow>();
      scoreRows.forEach((row) => subjectMap.set(row.subject_id, { id: row.subject_id, name: row.subject_name, short_code: null }));
      const subjectRows = [...subjectMap.values()].sort((a, b) => a.name.localeCompare(b.name));
      const comments = new Map((commentResult.data || []).map((x: CommentRow) => [x.student_id, x.form_teacher_comment || ""]));
      const scoreMap = new Map<string, BroadsheetRow[]>();
      for (const row of scoreRows) scoreMap.set(row.student_id, [...(scoreMap.get(row.student_id) || []), row]);
      const displayRows = ((studentResult.data || []) as StudentRow[]).map((student) => {
        const ownScores = scoreMap.get(student.id) || [];
        const first = ownScores[0];
        const bySubject: Record<string, BroadsheetRow> = {};
        ownScores.forEach((row) => { bySubject[row.subject_id] = row; });
        return { ...student, scores: bySubject, total: first ? Number(first.overall_total) : null,
          average: first ? Number(first.average_score) : null, position: first ? Number(first.class_position) : null,
          comment: comments.get(student.id) || "" };
      });
      setSubjects(subjectRows); setStudents(displayRows);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to load the class broadsheet."); }
    finally { setLoading(false); }
  }, [schoolId, classId, termId, supabase]);

  useEffect(() => { void loadBroadsheet(); }, [loadBroadsheet]);

  const updateComment = (studentId: string, value: string) => {
    setStudents((old) => old.map((s) => s.id === studentId ? { ...s, comment: value } : s));
    setDirty(true); setNotice("");
  };

  const saveComments = async () => {
    if (!classId || !termId) return;
    setSaving(true); setError(""); setNotice("");
    try {
      for (const student of students) {
        const { data: existing, error: findError } = await supabase.from("student_comments")
          .select("id").eq("school_id", schoolId).eq("student_id", student.id).eq("term_id", termId).maybeSingle();
        if (findError) throw findError;
        if (existing?.id) {
          const { error: updateError } = await supabase.from("student_comments").update({ form_teacher_comment: student.comment.trim() || null })
            .eq("id", existing.id).eq("school_id", schoolId);
          if (updateError) throw updateError;
        } else if (student.comment.trim()) {
          const { error: insertError } = await supabase.from("student_comments").insert({
            school_id: schoolId, student_id: student.id, class_id: classId, term_id: termId,
            form_teacher_comment: student.comment.trim(), conduct: {}, entered_by: teacherId,
          });
          if (insertError) throw insertError;
        }
      }
      setDirty(false); setNotice("Form-teacher comments saved successfully.");
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save form-teacher comments."); }
    finally { setSaving(false); }
  };

  const selectedClass = classes.find((c) => c.id === classId);
  const selectedTerm = terms.find((t) => t.id === termId);
  const classLabel = selectedClass ? `${selectedClass.name}${selectedClass.arm ? ` ${selectedClass.arm}` : ""}` : "";
  const completeCount = students.filter((s) => subjects.length > 0 && subjects.every((sub) => s.scores[sub.id]?.subject_total !== null && s.scores[sub.id]?.subject_total !== undefined)).length;
  const format = (value: number | null) => value === null || Number.isNaN(value) ? "—" : Number(value).toFixed(value % 1 ? 2 : 0);

  if (loading && !classes.length) return <div className="card p-8 text-center text-sm text-slate-500">Loading your form-teacher workspace...</div>;
  if (!classes.length) return <div className="card p-8 text-center"><BookOpen className="mx-auto text-slate-300" size={32}/><h3 className="font-bold mt-3">No form class assigned</h3><p className="text-sm text-slate-500 mt-1">The Results workspace is available only to teachers assigned as form teachers.</p></div>;

  return <section className="space-y-5">
    <div className="grid sm:grid-cols-3 gap-3">
      <div className="card p-4"><p className="text-xs text-slate-500">Form class</p><p className="font-bold text-xl mt-1">{classLabel || "—"}</p></div>
      <div className="card p-4"><p className="text-xs text-slate-500">Students with complete subject scores</p><p className="font-bold text-2xl mt-1">{completeCount}/{students.length}</p></div>
      <div className="card p-4"><p className="text-xs text-slate-500">Subjects assigned</p><p className="font-bold text-2xl mt-1">{subjects.length}</p></div>
    </div>
    <div className="card p-4 md:p-5">
      <div className="flex flex-col md:flex-row gap-3 md:items-end md:justify-between">
        <div className="grid sm:grid-cols-2 gap-3 flex-1">
          <div><label className="label">Form class</label><select className="field" value={classId} onChange={(e) => setClassId(e.target.value)}>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}{c.arm ? ` ${c.arm}` : ""}</option>)}</select></div>
          <div><label className="label">Academic term</label><select className="field" value={termId} onChange={(e) => setTermId(e.target.value)}><option value="">Select term</option>{terms.map((t) => <option key={t.id} value={t.id}>{t.term_name} · {t.status}</option>)}</select></div>
        </div>
        <button className="btn btn-light" onClick={() => void loadBroadsheet()} disabled={loading}><RefreshCw size={15} className={loading ? "animate-spin" : ""}/> Refresh</button>
      </div>
      {selectedTerm && selectedTerm.status !== "open" && <p className="mt-3 text-xs rounded-lg bg-amber-50 text-amber-800 p-3">This term is {selectedTerm.status}. Scores are read-only, and comments cannot be changed after the term is closed or published.</p>}
    </div>
    {error && <div className="rounded-xl bg-rose-50 border border-rose-100 p-3 text-sm text-rose-700 flex gap-2"><AlertCircle size={17}/>{error}</div>}
    {notice && <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-3 text-sm text-emerald-700">{notice}</div>}
    <div className="card p-4 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4"><div><h3 className="font-bold text-lg">{classLabel} broadsheet</h3><p className="text-xs text-slate-500 mt-1">Subject scores are calculated from each teacher's CA and examination entries. Only the comment column is editable.</p></div><button className="btn btn-primary" onClick={() => void saveComments()} disabled={saving || !dirty || selectedTerm?.status !== "open"}><Save size={15}/>{saving ? "Saving..." : "Save comments"}</button></div>
      {loading ? <div className="py-10 text-center text-sm text-slate-500">Loading broadsheet...</div> : !termId ? <p className="py-8 text-center text-sm text-slate-500">No academic term is available for the current session.</p> : !students.length ? <p className="py-8 text-center text-sm text-slate-500">No active students are registered in this class.</p> :
      <div className="overflow-x-auto"><table className="table w-full min-w-[900px]"><thead><tr><th>#</th><th>Student</th>{subjects.map((s) => <th key={s.id}>{s.name}<span className="block font-normal text-[10px] text-slate-400">Total / Grade</span></th>)}<th>Overall total</th><th>Average</th><th>Position</th><th>Form-teacher comment</th></tr></thead><tbody>
        {students.map((student, index) => <tr key={student.id}><td>{index + 1}</td><td><div className="font-semibold">{student.full_name}</div><div className="text-xs text-slate-400">{student.admission_number}</div></td>{subjects.map((subject) => { const score = student.scores[subject.id]; return <td key={subject.id}><span className="font-bold">{score && score.subject_total !== null ? format(Number(score.subject_total)) : "—"}</span>{score?.subject_grade && <span className="block text-xs text-slate-400">{score.subject_grade}</span>}</td>; })}<td className="font-black">{format(student.total)}</td><td>{format(student.average)}</td><td>{student.position ? `${student.position}${student.position === 1 ? "st" : student.position === 2 ? "nd" : student.position === 3 ? "rd" : "th"}` : "—"}</td><td><input className="field !min-w-56 !py-2" maxLength={500} value={student.comment} disabled={selectedTerm?.status !== "open"} onChange={(e) => updateComment(student.id, e.target.value)} placeholder="Enter form-teacher comment"/></td></tr>)}
      </tbody></table></div>}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400"><span>Broadsheet figures are read-only and come from get_class_broadsheet().</span><span>{dirty ? "Unsaved comments" : "Comments saved"}</span></div>
    </div>
    <div className="rounded-xl bg-blue-50 border border-blue-100 p-4 text-sm text-blue-900"><Trophy className="inline mr-2" size={16}/>The overall total, average and position are calculated from the subject scores currently saved for this class and term.</div>
  </section>;
}
