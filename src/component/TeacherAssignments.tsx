"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { AlertCircle, CheckCircle2, Pencil, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Props = { schoolId: string; isAdmin: boolean };
type Teacher = { id: string; full_name: string; email: string | null; is_active: boolean };
type SchoolClass = { id: string; name: string; arm: string | null; level_order: number | null };
type Subject = { id: string; name: string; short_code: string | null; is_active: boolean };
type Assignment = { id: string; teacher_id: string; class_id: string; subject_id: string | null; is_form_teacher: boolean };
type Draft = { teacher_id: string; class_id: string; assignment_type: "subject" | "form"; subject_id: string };
const blankDraft: Draft = { teacher_id: "", class_id: "", assignment_type: "subject", subject_id: "" };

const classLabel = (item: SchoolClass) => `${item.name}${item.arm ? ` ${item.arm}` : ""}`;

export default function TeacherAssignments({ schoolId, isAdmin }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "subject" | "form">("all");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Assignment | null>(null);
  const [draft, setDraft] = useState<Draft>(blankDraft);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [teacherResult, classResult, subjectResult, assignmentResult] = await Promise.all([
        supabase.from("profiles").select("id,full_name,email,is_active")
          .eq("school_id", schoolId).eq("role", "teacher").order("full_name", { ascending: true }),
        supabase.from("classes").select("id,name,arm,level_order")
          .eq("school_id", schoolId).order("level_order", { ascending: true, nullsFirst: false })
          .order("name", { ascending: true }).order("arm", { ascending: true }),
        supabase.from("subjects").select("id,name,short_code,is_active")
          .eq("school_id", schoolId).order("name", { ascending: true }),
        supabase.from("teacher_assignments")
          .select("id,teacher_id,class_id,subject_id,is_form_teacher")
          .eq("school_id", schoolId),
      ]);
      if (teacherResult.error) throw teacherResult.error;
      if (classResult.error) throw classResult.error;
      if (subjectResult.error) throw subjectResult.error;
      if (assignmentResult.error) throw assignmentResult.error;
      setTeachers((teacherResult.data || []) as Teacher[]);
      setClasses((classResult.data || []) as SchoolClass[]);
      setSubjects((subjectResult.data || []) as Subject[]);
      setAssignments((assignmentResult.data || []) as Assignment[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load teacher assignments.");
    } finally { setLoading(false); }
  }, [schoolId, supabase]);

  useEffect(() => { void load(); }, [load]);

  const teacherById = useMemo(() => new Map(teachers.map(x => [x.id, x])), [teachers]);
  const classById = useMemo(() => new Map(classes.map(x => [x.id, x])), [classes]);
  const subjectById = useMemo(() => new Map(subjects.map(x => [x.id, x])), [subjects]);

  const openNew = () => {
    setEditing(null);
    setDraft({ ...blankDraft, teacher_id: teachers.find(t => t.is_active)?.id || "", class_id: classes[0]?.id || "", subject_id: subjects.find(s => s.is_active)?.id || "" });
    setError(""); setNotice(""); setShowForm(true);
  };
  const openEdit = (item: Assignment) => {
    setEditing(item);
    setDraft({ teacher_id: item.teacher_id, class_id: item.class_id, assignment_type: item.is_form_teacher ? "form" : "subject", subject_id: item.subject_id || "" });
    setError(""); setNotice(""); setShowForm(true);
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isAdmin) return;
    if (!draft.teacher_id || !draft.class_id) { setError("Choose a teacher and a class."); return; }
    if (draft.assignment_type === "subject" && !draft.subject_id) { setError("Choose a subject for a subject-teacher assignment."); return; }
    const teacher = teacherById.get(draft.teacher_id);
    const chosenClass = classById.get(draft.class_id);
    const subject = draft.assignment_type === "subject" ? subjectById.get(draft.subject_id) : null;
    if (!teacher || !teacher.is_active) { setError("Choose an active teacher account. Inactive teacher accounts cannot receive new assignments."); return; }
    if (!chosenClass) { setError("Choose a valid class belonging to this school."); return; }
    if (draft.assignment_type === "subject" && (!subject || !subject.is_active)) { setError("Choose an active subject."); return; }

    setSaving(true); setError(""); setNotice("");
    try {
      const payload = {
        school_id: schoolId,
        teacher_id: draft.teacher_id,
        class_id: draft.class_id,
        subject_id: draft.assignment_type === "form" ? null : draft.subject_id,
        is_form_teacher: draft.assignment_type === "form",
      };
      const result = editing
        ? await supabase.from("teacher_assignments").update(payload).eq("id", editing.id).eq("school_id", schoolId)
        : await supabase.from("teacher_assignments").insert(payload);
      if (result.error) {
        if (result.error.code === "23505") {
          throw new Error(draft.assignment_type === "form"
            ? "This class already has a form teacher. Edit that assignment or remove it first."
            : "This teacher is already assigned to that subject in this class.");
        }
        if (result.error.code === "23503") throw new Error("The selected teacher, class or subject is no longer available. Refresh and try again.");
        throw result.error;
      }
      setShowForm(false); setEditing(null); setDraft(blankDraft);
      await load();
      setNotice(editing ? "Teacher assignment updated." : "Teacher assignment created.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save this assignment.");
    } finally { setSaving(false); }
  };

  const remove = async (item: Assignment) => {
    if (!isAdmin) return;
    const teacherName = teacherById.get(item.teacher_id)?.full_name || "this teacher";
    const target = item.is_form_teacher ? "form-teacher assignment" : "subject assignment";
    if (!window.confirm(`Remove ${teacherName}'s ${target} for ${classById.get(item.class_id) ? classLabel(classById.get(item.class_id)!) : "this class"}?`)) return;
    setDeleting(item.id); setError(""); setNotice("");
    try {
      const { error: deleteError } = await supabase.from("teacher_assignments")
        .delete().eq("id", item.id).eq("school_id", schoolId);
      if (deleteError) throw deleteError;
      await load(); setNotice("Assignment removed successfully.");
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to remove this assignment."); }
    finally { setDeleting(null); }
  };

  const filtered = assignments.filter(item => {
    const teacher = teacherById.get(item.teacher_id);
    const klass = classById.get(item.class_id);
    const subject = item.subject_id ? subjectById.get(item.subject_id) : null;
    const text = `${teacher?.full_name || ""} ${teacher?.email || ""} ${klass ? classLabel(klass) : ""} ${subject?.name || ""} ${subject?.short_code || ""}`.toLowerCase();
    const matchesText = text.includes(search.trim().toLowerCase());
    const matchesType = typeFilter === "all" || (typeFilter === "form" ? item.is_form_teacher : !item.is_form_teacher);
    return matchesText && matchesType;
  });
  const activeTeachers = teachers.filter(t => t.is_active).length;
  const formCount = assignments.filter(a => a.is_form_teacher).length;
  const subjectCount = assignments.filter(a => !a.is_form_teacher).length;

  return <section className="space-y-5">
    <div className="card p-5 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h3 className="text-lg font-bold">Teacher assignments</h3><p className="text-sm text-slate-500 mt-1">Allocate active teacher accounts to classes and subjects, and designate form teachers.</p></div>
        <div className="flex gap-2"><button className="btn btn-light" onClick={() => void load()} disabled={loading || saving}><RefreshCw size={15}/> Refresh</button>{isAdmin && <button className="btn btn-primary" onClick={openNew} disabled={!activeTeachers || !classes.length}><Plus size={15}/> New assignment</button>}</div>
      </div>
      {error && <div className="mt-4 rounded-xl bg-rose-50 border border-rose-100 p-3 text-sm text-rose-700 flex gap-2"><AlertCircle size={16} className="shrink-0 mt-0.5"/>{error}</div>}
      {notice && <div className="mt-4 rounded-xl bg-emerald-50 border border-emerald-100 p-3 text-sm text-emerald-700 flex gap-2"><CheckCircle2 size={16} className="shrink-0 mt-0.5"/>{notice}</div>}
      {showForm && <form onSubmit={save} className="mt-5 rounded-2xl border border-blue-100 bg-blue-50/50 p-4 space-y-3">
        <div className="flex justify-between items-center"><h4 className="font-bold">{editing ? "Edit assignment" : "Create assignment"}</h4><button type="button" onClick={() => setShowForm(false)} aria-label="Close form"><X size={18}/></button></div>
        <div className="grid sm:grid-cols-2 gap-3">
          <div><label className="label">Teacher *</label><select className="field" required value={draft.teacher_id} onChange={e => setDraft(d => ({ ...d, teacher_id: e.target.value }))}><option value="">Select teacher</option>{teachers.filter(t => t.is_active || t.id === draft.teacher_id).map(t => <option key={t.id} value={t.id}>{t.full_name}{!t.is_active ? " (Inactive — existing assignment)" : ""}</option>)}</select></div>
          <div><label className="label">Class *</label><select className="field" required value={draft.class_id} onChange={e => setDraft(d => ({ ...d, class_id: e.target.value }))}><option value="">Select class</option>{classes.map(c => <option key={c.id} value={c.id}>{classLabel(c)}</option>)}</select></div>
          <div><label className="label">Assignment type *</label><select className="field" value={draft.assignment_type} onChange={e => setDraft(d => ({ ...d, assignment_type: e.target.value as Draft["assignment_type"] }))}><option value="subject">Subject teacher</option><option value="form">Form teacher</option></select></div>
          {draft.assignment_type === "subject" && <div><label className="label">Subject *</label><select className="field" required value={draft.subject_id} onChange={e => setDraft(d => ({ ...d, subject_id: e.target.value }))}><option value="">Select subject</option>{subjects.filter(s => s.is_active || s.id === draft.subject_id).map(s => <option key={s.id} value={s.id}>{s.name}{s.short_code ? ` (${s.short_code})` : ""}{!s.is_active ? " (Inactive — existing assignment)" : ""}</option>)}</select></div>}
        </div>
        <p className="text-xs text-slate-500">A form-teacher assignment is saved with no subject. A subject-teacher assignment must have one subject. The database prevents duplicate assignments and more than one form teacher per class.</p>
        <div className="flex gap-2"><button className="btn btn-primary" type="submit" disabled={saving}>{saving ? "Saving..." : editing ? "Save changes" : "Create assignment"}</button><button className="btn btn-light" type="button" onClick={() => setShowForm(false)} disabled={saving}>Cancel</button></div>
      </form>}
    </div>
    <div className="grid sm:grid-cols-3 gap-3">
      <div className="card p-4"><p className="text-xs text-slate-500">Subject assignments</p><p className="text-2xl font-black mt-1">{subjectCount}</p></div>
      <div className="card p-4"><p className="text-xs text-slate-500">Form teachers designated</p><p className="text-2xl font-black mt-1">{formCount}</p></div>
      <div className="card p-4"><p className="text-xs text-slate-500">Active teacher accounts</p><p className="text-2xl font-black mt-1">{activeTeachers}</p></div>
    </div>
    <div className="card p-5 md:p-6">
      <div className="grid sm:grid-cols-[minmax(0,1fr)_200px] gap-3">
        <div className="relative"><Search size={16} className="absolute left-3 top-3 text-slate-400"/><input className="field pl-9" placeholder="Search teacher, class or subject" value={search} onChange={e => setSearch(e.target.value)}/></div>
        <select className="field" value={typeFilter} onChange={e => setTypeFilter(e.target.value as typeof typeFilter)}><option value="all">All assignment types</option><option value="subject">Subject teachers</option><option value="form">Form teachers</option></select>
      </div>
      {loading ? <div className="py-12 text-center text-sm text-slate-500">Loading teacher assignments...</div> : assignments.length === 0 ? <div className="py-12 text-center border border-dashed border-slate-200 rounded-2xl mt-4"><h4 className="font-bold">No assignments yet</h4><p className="text-sm text-slate-500 mt-1">Create teacher accounts, classes and subjects first, then make your first assignment.</p>{isAdmin && <button className="btn btn-primary mt-4" onClick={openNew} disabled={!activeTeachers || !classes.length}><Plus size={15}/> Create first assignment</button>}</div> : filtered.length === 0 ? <p className="text-sm text-slate-500 text-center py-8">No assignments match your search or filter.</p> : <div className="overflow-x-auto mt-4"><table className="table w-full"><thead><tr><th>Teacher</th><th>Class</th><th>Subject / role</th><th>Type</th>{isAdmin && <th>Actions</th>}</tr></thead><tbody>{filtered.map(item => {
        const teacher = teacherById.get(item.teacher_id); const klass = classById.get(item.class_id); const subject = item.subject_id ? subjectById.get(item.subject_id) : null;
        return <tr key={item.id}><td><div className="font-semibold">{teacher?.full_name || "Unknown teacher"}</div><div className="text-xs text-slate-400 break-all">{teacher?.email || ""}</div>{teacher && !teacher.is_active && <span className="pill bg-slate-100 text-slate-500 mt-1">Inactive account</span>}</td><td>{klass ? classLabel(klass) : "Unknown class"}</td><td>{item.is_form_teacher ? <span className="font-semibold">Form teacher</span> : <><span className="font-semibold">{subject?.name || "Unknown subject"}</span>{subject?.short_code && <span className="text-xs text-slate-400 block">{subject.short_code}</span>}</>}</td><td><span className={`pill ${item.is_form_teacher ? "bg-violet-50 text-violet-700" : "bg-blue-50 text-blue-700"}`}>{item.is_form_teacher ? "Form" : "Subject"}</span></td>{isAdmin && <td><div className="flex gap-1"><button className="p-2 rounded-lg text-slate-500 hover:bg-slate-100" onClick={() => openEdit(item)} aria-label="Edit assignment"><Pencil size={15}/></button><button className="p-2 rounded-lg text-rose-600 hover:bg-rose-50 disabled:opacity-50" disabled={deleting === item.id} onClick={() => void remove(item)} aria-label="Remove assignment"><Trash2 size={15}/></button></div></td>}</tr>;
      })}</tbody></table><p className="text-xs text-slate-400 mt-3">Showing {filtered.length} of {assignments.length} assignments.</p></div>}
    </div>
    <div className="rounded-xl bg-blue-50 border border-blue-100 p-4 text-sm text-blue-900"><strong>Access control:</strong> Teacher assignments are stored per school. The database policies and score-entry function remain responsible for authorising teachers to access their assigned classes and subjects.</div>
  </section>;
}
