"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, Users, RefreshCw, AlertCircle, GraduationCap, ClipboardList } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Props = { schoolId: string; teacherId: string };
type Assignment = { id: string; class_id: string; subject_id: string | null; is_form_teacher: boolean };
type ClassRow = { id: string; name: string; arm: string | null; level_order: number | null };
type SubjectRow = { id: string; name: string; short_code: string | null };
type StudentRow = { id: string; class_id: string; admission_number: string; full_name: string; gender: string | null; is_active: boolean };

type TeachingClass = { classInfo: ClassRow; assignments: Assignment[]; subjects: SubjectRow[]; isFormTeacher: boolean; students: StudentRow[] };

export default function TeacherWorkspace({ schoolId, teacherId }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [classes, setClasses] = useState<TeachingClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

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
      if (!classIds.length) { setClasses([]); return; }

      const subjectIds = [...new Set(assignments.map((item) => item.subject_id).filter((id): id is string => Boolean(id)))];
      const [classResult, subjectResult, studentResult] = await Promise.all([
        supabase.from("classes").select("id,name,arm,level_order").eq("school_id", schoolId).in("id", classIds),
        subjectIds.length
          ? supabase.from("subjects").select("id,name,short_code").eq("school_id", schoolId).in("id", subjectIds)
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
      setClasses(classRows.map((classInfo) => {
        const ownAssignments = assignments.filter((item) => item.class_id === classInfo.id);
        const ids = ownAssignments.map((item) => item.subject_id).filter((id): id is string => Boolean(id));
        return {
          classInfo,
          assignments: ownAssignments,
          subjects: subjectRows.filter((subject) => ids.includes(subject.id)),
          isFormTeacher: ownAssignments.some((item) => item.is_form_teacher),
          students: studentRows.filter((student) => student.class_id === classInfo.id),
        };
      }).sort((a, b) => (a.classInfo.level_order ?? 999) - (b.classInfo.level_order ?? 999) || a.classInfo.name.localeCompare(b.classInfo.name)));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to load your teaching assignments.");
    } finally { setLoading(false); }
  }, [schoolId, teacherId, supabase]);

  useEffect(() => { void load(); }, [load]);

  const filtered = classes.filter((item) => {
    const term = query.trim().toLowerCase();
    if (!term) return true;
    return `${item.classInfo.name} ${item.classInfo.arm || ""} ${item.subjects.map((s) => s.name).join(" ")}`.toLowerCase().includes(term);
  });
  const totalStudents = classes.reduce((sum, item) => sum + item.students.length, 0);
  const subjectCount = new Set(classes.flatMap((item) => item.subjects.map((s) => s.id))).size;
  const formTeacherCount = classes.filter((item) => item.isFormTeacher).length;

  return <section className="space-y-5">
    <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
      <div className="card p-4"><div className="flex items-center justify-between"><p className="text-xs text-slate-500">My classes</p><BookOpen className="text-[#3157d5]" size={19}/></div><p className="text-2xl font-black mt-2">{classes.length}</p></div>
      <div className="card p-4"><div className="flex items-center justify-between"><p className="text-xs text-slate-500">My subjects</p><GraduationCap className="text-[#3157d5]" size={19}/></div><p className="text-2xl font-black mt-2">{subjectCount}</p></div>
      <div className="card p-4 col-span-2 xl:col-span-1"><div className="flex items-center justify-between"><p className="text-xs text-slate-500">Assigned students</p><Users className="text-[#3157d5]" size={19}/></div><p className="text-2xl font-black mt-2">{totalStudents}</p><p className="text-xs text-slate-400 mt-1">{formTeacherCount} form-teacher assignment(s)</p></div>
    </div>
    <div className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div><h3 className="font-bold text-lg">My teaching assignments</h3><p className="text-xs text-slate-400 mt-1">Only classes and subjects assigned to your teacher account appear here.</p></div>
        <button className="btn btn-light" onClick={() => void load()} disabled={loading}><RefreshCw size={15} className={loading ? "animate-spin" : ""}/> Refresh</button>
      </div>
      <input className="field mb-4" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search my classes or subjects..." />
      {error && <div className="p-3 rounded-xl bg-rose-50 text-rose-700 text-sm flex gap-2"><AlertCircle size={17}/>{error}</div>}
      {loading ? <div className="py-10 text-center text-sm text-slate-400">Loading your assignments...</div> : filtered.length === 0 ?
        <div className="py-10 text-center border border-dashed border-slate-200 rounded-2xl"><ClipboardList className="mx-auto text-slate-300" size={30}/><h4 className="font-bold mt-3">{classes.length ? "No matching assignments" : "No teaching assignments yet"}</h4><p className="text-sm text-slate-500 mt-1">{classes.length ? "Try another search." : "Ask your school administrator to assign your classes and subjects in Klasrum."}</p></div> :
        <div className="grid xl:grid-cols-2 gap-4">{filtered.map((item) => <article key={item.classInfo.id} className="rounded-2xl border border-slate-200 p-4">
          <div className="flex items-start justify-between gap-3"><div><h4 className="font-bold text-base">{item.classInfo.name}{item.classInfo.arm ? ` ${item.classInfo.arm}` : ""}</h4><p className="text-xs text-slate-400 mt-1">{item.students.length} active student(s)</p></div>{item.isFormTeacher && <span className="pill bg-violet-50 text-violet-700">Form teacher</span>}</div>
          <div className="mt-4"><p className="text-xs font-semibold text-slate-500 mb-2">Assigned subjects</p>{item.subjects.length ? <div className="flex flex-wrap gap-2">{item.subjects.map((subject) => <span key={subject.id} className="pill bg-blue-50 text-blue-700">{subject.name}{subject.short_code ? ` · ${subject.short_code}` : ""}</span>)}</div> : <p className="text-sm text-slate-400">No subject assignments for this class.</p>}</div>
          <div className="mt-4 border-t border-slate-100 pt-3"><p className="text-xs font-semibold text-slate-500 mb-2">Students in this class</p>{item.students.length ? <div className="max-h-56 overflow-y-auto divide-y divide-slate-100">{item.students.map((student) => <div key={student.id} className="py-2 flex items-center justify-between gap-3"><div className="min-w-0"><p className="text-sm font-medium truncate">{student.full_name}</p><p className="text-xs text-slate-400">{student.admission_number}</p></div><span className="text-xs text-slate-400">{student.gender || "—"}</span></div>)}</div> : <p className="text-sm text-slate-400">No active students are registered in this class.</p>}</div>
        </article>)}</div>}
    </div>
  </section>;
}
