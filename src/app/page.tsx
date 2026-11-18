"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BookOpen, Users, GraduationCap, ClipboardCheck, ChartNoAxesCombined,
  Settings, Search, Bell, ChevronDown, Plus, ShieldCheck, Menu, X,
  CheckCircle2, School, LogOut, Pencil, UserPlus, RefreshCw, AlertCircle,
  UserCheck, UserX
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Role = "Admin" | "Teacher" | "Student";
type WorkspaceIdentity = {
  userId: string;
  fullName: string;
  email: string;
  role: Role;
  schoolId: string;
  schoolName: string;
  schoolSlug: string;
  logoUrl: string | null;
};
type ClassRecord = {
  id: string;
  school_id: string;
  name: string;
  arm: string;
  level_order: number | null;
};
type StudentRecord = {
  id: string;
  school_id: string;
  class_id: string;
  admission_number: string;
  full_name: string;
  gender: string | null;
  date_of_birth: string | null;
  admitted_on: string | null;
  is_active: boolean;
};
type ClassForm = { name: string; arm: string; level_order: string };
type StudentForm = {
  admission_number: string;
  full_name: string;
  class_id: string;
  gender: string;
  date_of_birth: string;
  admitted_on: string;
};

const nav = [
  ["Overview", ChartNoAxesCombined],
  ["Classes & Students", Users],
  ["Teacher Assignments", GraduationCap],
  ["Attendance", ClipboardCheck],
  ["Results & Publishing", BookOpen],
  ["Scratch Cards", ShieldCheck],
  ["School Settings", Settings],
] as const;

const roleLabel = (value: string): Role =>
  value === "admin" ? "Admin" : value === "teacher" ? "Teacher" : "Student";

const schoolInitials = (name: string) =>
  name.split(",")[0].split(/\s+/).filter(Boolean).slice(0, 3)
    .map((word) => word[0]).join("").toUpperCase() || "S";

const personInitials = (name: string) =>
  name.trim().split(/\s+/).filter(Boolean).slice(0, 2)
    .map((word) => word[0]).join("").toUpperCase() || "U";

const emptyClassForm: ClassForm = { name: "", arm: "", level_order: "" };
const emptyStudentForm: StudentForm = {
  admission_number: "", full_name: "", class_id: "", gender: "",
  date_of_birth: "", admitted_on: new Date().toISOString().slice(0, 10),
};

export default function Home() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [identity, setIdentity] = useState<WorkspaceIdentity | null>(null);
  const [identityLoading, setIdentityLoading] = useState(true);
  const [identityError, setIdentityError] = useState("");
  const [active, setActive] = useState("Overview");
  const [mobile, setMobile] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const [notice, setNotice] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [classes, setClasses] = useState<ClassRecord[]>([]);
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordsError, setRecordsError] = useState("");
  const [selectedClassId, setSelectedClassId] = useState("all");
  const [search, setSearch] = useState("");
  const [showClassForm, setShowClassForm] = useState(false);
  const [editingClass, setEditingClass] = useState<ClassRecord | null>(null);
  const [classForm, setClassForm] = useState<ClassForm>(emptyClassForm);
  const [savingClass, setSavingClass] = useState(false);
  const [showStudentForm, setShowStudentForm] = useState(false);
  const [editingStudent, setEditingStudent] = useState<StudentRecord | null>(null);
  const [studentForm, setStudentForm] = useState<StudentForm>(emptyStudentForm);
  const [savingStudent, setSavingStudent] = useState(false);
  const [savingStudentStatus, setSavingStudentStatus] = useState<string | null>(null);

  const flash = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 4000);
  }, []);

  const loadWorkspace = useCallback(async () => {
    try {
      setIdentityLoading(true);
      setIdentityError("");
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!user) {
        router.replace("/login");
        return;
      }

      const trustedSchoolId = String(user.app_metadata?.school_id || "");
      const trustedRole = String(user.app_metadata?.role || "").toLowerCase();
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("id,full_name,email,role,school_id")
        .eq("id", user.id)
        .single();
      if (profileError) throw profileError;
      if (!profile?.school_id) throw new Error("Your profile has no school assignment. Please contact your school administrator.");

      const profileRole = String(profile.role || "").toLowerCase();
      if (!["admin", "teacher", "student"].includes(profileRole)) {
        throw new Error("Your account has an unsupported role.");
      }
      if (trustedSchoolId && trustedSchoolId !== profile.school_id) {
        throw new Error("Your account and profile school assignments do not match.");
      }
      if (trustedRole && trustedRole !== profileRole) {
        throw new Error("Your account role and profile role do not match.");
      }

      const { data: school, error: schoolError } = await supabase
        .from("schools")
        .select("id,name,slug,logo_url")
        .eq("id", profile.school_id)
        .single();
      if (schoolError) throw schoolError;
      if (!school) throw new Error("The school linked to your account could not be found.");

      setIdentity({
        userId: user.id,
        fullName: String(profile.full_name || user.email || "School user"),
        email: String(profile.email || user.email || ""),
        role: roleLabel(profileRole),
        schoolId: school.id,
        schoolName: school.name,
        schoolSlug: school.slug,
        logoUrl: school.logo_url || null,
      });
    } catch (error: unknown) {
      setIdentityError(error instanceof Error ? error.message : "Unable to load your school workspace.");
    } finally {
      setIdentityLoading(false);
    }
  }, [router, supabase]);

  const loadSchoolRecords = useCallback(async (schoolId: string) => {
    setRecordsLoading(true);
    setRecordsError("");
    try {
      const [classResult, studentResult] = await Promise.all([
        supabase.from("classes")
          .select("id,school_id,name,arm,level_order")
          .eq("school_id", schoolId)
          .order("level_order", { ascending: true, nullsFirst: false })
          .order("name", { ascending: true })
          .order("arm", { ascending: true }),
        supabase.from("students")
          .select("id,school_id,class_id,admission_number,full_name,gender,date_of_birth,admitted_on,is_active")
          .eq("school_id", schoolId)
          .order("full_name", { ascending: true }),
      ]);
      if (classResult.error) throw classResult.error;
      if (studentResult.error) throw studentResult.error;
      setClasses((classResult.data || []) as ClassRecord[]);
      setStudents((studentResult.data || []) as StudentRecord[]);
    } catch (error: unknown) {
      setRecordsError(error instanceof Error ? error.message : "Unable to load classes and students.");
    } finally {
      setRecordsLoading(false);
    }
  }, [supabase]);

  useEffect(() => { void loadWorkspace(); }, [loadWorkspace]);

  useEffect(() => {
    if (identity?.schoolId) void loadSchoolRecords(identity.schoolId);
  }, [identity?.schoolId, loadSchoolRecords]);

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      setErrorMessage(`Sign out failed: ${error.message}`);
      return;
    }
    router.replace("/login");
    router.refresh();
  };

  const startNewClass = () => {
    setEditingClass(null);
    setClassForm(emptyClassForm);
    setShowClassForm(true);
    setErrorMessage("");
  };

  const startEditClass = (item: ClassRecord) => {
    setEditingClass(item);
    setClassForm({
      name: item.name,
      arm: item.arm || "",
      level_order: item.level_order === null ? "" : String(item.level_order),
    });
    setShowClassForm(true);
    setErrorMessage("");
  };

  const saveClass = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!identity) return;
    const name = classForm.name.trim();
    const arm = classForm.arm.trim();
    if (!name) {
      setErrorMessage("Enter a class name.");
      return;
    }
    setSavingClass(true);
    setErrorMessage("");
    try {
      const payload = {
        name,
        arm,
        level_order: classForm.level_order.trim() === "" ? null : Number(classForm.level_order),
      };
      const result = editingClass
        ? await supabase.from("classes").update(payload)
            .eq("id", editingClass.id).eq("school_id", identity.schoolId)
        : await supabase.from("classes").insert({ ...payload, school_id: identity.schoolId });
      if (result.error) {
        if (result.error.code === "23505") throw new Error("That class and arm already exists in this school.");
        throw result.error;
      }
      setShowClassForm(false);
      setEditingClass(null);
      setClassForm(emptyClassForm);
      await loadSchoolRecords(identity.schoolId);
      flash(editingClass ? "Class updated successfully." : "Class created successfully.");
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to save this class.");
    } finally {
      setSavingClass(false);
    }
  };

  const startNewStudent = () => {
    setEditingStudent(null);
    setStudentForm({
      ...emptyStudentForm,
      class_id: selectedClassId === "all" ? (classes[0]?.id || "") : selectedClassId,
    });
    setShowStudentForm(true);
    setErrorMessage("");
  };

  const startEditStudent = (student: StudentRecord) => {
    setEditingStudent(student);
    setStudentForm({
      admission_number: student.admission_number,
      full_name: student.full_name,
      class_id: student.class_id,
      gender: student.gender || "",
      date_of_birth: student.date_of_birth || "",
      admitted_on: student.admitted_on || "",
    });
    setShowStudentForm(true);
    setErrorMessage("");
  };

  const saveStudent = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!identity) return;
    if (!studentForm.class_id) {
      setErrorMessage("Create a class before registering a student.");
      return;
    }
    if (!studentForm.full_name.trim() || !studentForm.admission_number.trim()) {
      setErrorMessage("Student name and admission number are required.");
      return;
    }
    const chosenClass = classes.find((item) => item.id === studentForm.class_id);
    if (!chosenClass || chosenClass.school_id !== identity.schoolId) {
      setErrorMessage("Choose a valid class belonging to this school.");
      return;
    }

    setSavingStudent(true);
    setErrorMessage("");
    try {
      const payload = {
        class_id: studentForm.class_id,
        admission_number: studentForm.admission_number.trim(),
        full_name: studentForm.full_name.trim(),
        gender: studentForm.gender || null,
        date_of_birth: studentForm.date_of_birth || null,
        admitted_on: studentForm.admitted_on || null,
      };
      const result = editingStudent
        ? await supabase.from("students").update(payload)
            .eq("id", editingStudent.id).eq("school_id", identity.schoolId)
        : await supabase.from("students").insert({ ...payload, school_id: identity.schoolId });
      if (result.error) {
        if (result.error.code === "23505") throw new Error("That admission number is already in use in this school.");
        throw result.error;
      }
      setShowStudentForm(false);
      setEditingStudent(null);
      setStudentForm(emptyStudentForm);
      await loadSchoolRecords(identity.schoolId);
      flash(editingStudent ? "Student record updated." : "Student registered successfully.");
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to save this student.");
    } finally {
      setSavingStudent(false);
    }
  };

  const toggleStudentStatus = async (student: StudentRecord) => {
    if (!identity) return;
    setSavingStudentStatus(student.id);
    setErrorMessage("");
    try {
      const { error } = await supabase.from("students")
        .update({ is_active: !student.is_active })
        .eq("id", student.id)
        .eq("school_id", identity.schoolId);
      if (error) throw error;
      await loadSchoolRecords(identity.schoolId);
      flash(student.is_active ? "Student deactivated." : "Student reactivated.");
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to update student status.");
    } finally {
      setSavingStudentStatus(null);
    }
  };

  const selectedClass = classes.find((item) => item.id === selectedClassId);
  const filteredStudents = students.filter((student) => {
    const matchesClass = selectedClassId === "all" || student.class_id === selectedClassId;
    const term = search.trim().toLowerCase();
    const matchesSearch = !term ||
      student.full_name.toLowerCase().includes(term) ||
      student.admission_number.toLowerCase().includes(term);
    return matchesClass && matchesSearch;
  });
  const classStudentCount = (classId: string) => students.filter((student) => student.class_id === classId).length;
  const activeStudents = students.filter((student) => student.is_active).length;
  const navItems = identity?.role === "Admin" ? nav :
    identity?.role === "Teacher"
      ? [["Overview", ChartNoAxesCombined], ["Classes & Students", Users], ["Attendance", ClipboardCheck]] as const
      : [["Overview", ChartNoAxesCombined]] as const;
  const title = active === "Overview" ? "School overview" : active;

  if (identityLoading) {
    return <div className="min-h-screen grid place-items-center bg-slate-50 p-6">
      <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center max-w-sm w-full shadow-sm">
        <div className="w-12 h-12 rounded-2xl bg-[#3157d5] text-white grid place-items-center font-black text-xl mx-auto">K</div>
        <h1 className="font-bold mt-4">Loading your Klasrum workspace</h1>
        <p className="text-sm text-slate-500 mt-2">Verifying your account and school...</p>
      </div>
    </div>;
  }

  if (identityError || !identity) {
    return <div className="min-h-screen grid place-items-center bg-slate-50 p-6">
      <div className="rounded-2xl bg-white border border-slate-200 p-8 max-w-md w-full shadow-sm">
        <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 grid place-items-center mx-auto"><ShieldCheck size={23} /></div>
        <h1 className="font-bold text-lg text-center mt-4">Workspace could not be loaded</h1>
        <p className="text-sm text-slate-500 text-center mt-2">{identityError || "Your school account could not be verified."}</p>
        <div className="flex gap-2 mt-6">
          <button className="btn btn-primary flex-1" onClick={() => void loadWorkspace()}>Try again</button>
          <button className="btn btn-light flex-1" onClick={signOut}>Sign out</button>
        </div>
      </div>
    </div>;
  }

  return <div className="min-h-screen flex bg-slate-50">
    <aside className={`${mobile ? "fixed inset-y-0 left-0 z-40" : "hidden"} lg:flex w-[250px] shrink-0 bg-[#17233b] text-white flex-col`}>
      <div className="px-6 py-6 flex items-center gap-3 border-b border-white/10">
        <div className="w-10 h-10 rounded-xl bg-[#3157d5] grid place-items-center font-black text-xl">K</div>
        <div><div className="font-black tracking-wide text-lg">klasrum</div><div className="text-[10px] text-slate-400 tracking-[.18em] uppercase">School, in sync</div></div>
        <button className="lg:hidden ml-auto" onClick={() => setMobile(false)} aria-label="Close menu"><X size={18} /></button>
      </div>
      <div className="px-5 py-5">
        <div className="text-[10px] text-slate-400 uppercase tracking-widest mb-2">Workspace</div>
        <div className="rounded-xl bg-white/8 border border-white/10 p-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-[#dce8ff] text-[#3157d5] grid place-items-center overflow-hidden shrink-0">
            {identity.logoUrl && !logoFailed
              ? <img src={identity.logoUrl} alt={`${identity.schoolName} logo`} className="w-full h-full object-contain" onError={() => setLogoFailed(true)} />
              : <span className="text-[11px] font-black">{schoolInitials(identity.schoolName)}</span>}
          </div>
          <div className="min-w-0"><div className="text-sm font-bold truncate">{identity.schoolName}</div><div className="text-[10px] text-slate-400">{identity.schoolSlug}</div></div>
          <ChevronDown size={14} className="ml-auto text-slate-400" />
        </div>
      </div>
      <nav className="px-3 space-y-1 flex-1">
        {navItems.map(([label, Icon]) => <button key={label} onClick={() => { setActive(label); setMobile(false); }}
          className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm text-left ${active === label ? "bg-[#3157d5] text-white shadow-lg shadow-blue-950/30" : "text-slate-300 hover:bg-white/8"}`}>
          <Icon size={17} />{label}
        </button>)}
      </nav>
      <div className="p-4">
        <div className="rounded-xl bg-white/6 p-3 text-xs text-slate-300">
          <div className="flex items-center gap-2 mb-1"><ShieldCheck size={15} className="text-emerald-300" />Secure workspace</div>
          <p className="text-[10px] text-slate-500 leading-relaxed">School data is isolated by tenant-level access policies.</p>
        </div>
        <button onClick={signOut} className="w-full flex items-center gap-3 px-4 py-3 mt-3 text-sm text-slate-400 hover:text-white"><LogOut size={16} /> Sign out</button>
      </div>
    </aside>

    {mobile && <div className="fixed inset-0 bg-black/40 z-30 lg:hidden" onClick={() => setMobile(false)} />}

    <main className="flex-1 min-w-0">
      <header className="h-[76px] bg-white border-b border-slate-200/70 px-4 md:px-8 flex items-center justify-between sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <button className="lg:hidden p-2 rounded-lg bg-slate-100" onClick={() => setMobile(true)} aria-label="Open menu"><Menu size={19} /></button>
          <div><div className="text-xs text-slate-400">{identity.schoolName} / {identity.role}</div><h1 className="font-bold text-lg">{title}</h1></div>
        </div>
        <div className="flex items-center gap-2 md:gap-4">
          <div className="hidden md:flex items-center gap-2 bg-slate-100 rounded-xl px-3 py-2"><Search size={15} className="text-slate-400" /><span className="text-xs text-slate-500">School workspace</span></div>
          <button className="relative p-2 text-slate-500" aria-label="Notifications"><Bell size={19} /></button>
          <div className="h-9 w-9 rounded-full bg-[#e8edff] text-[#3157d5] grid place-items-center text-xs font-black">{personInitials(identity.fullName)}</div>
          <div className="hidden sm:block"><div className="text-xs font-bold">{identity.fullName}</div><div className="text-[10px] text-slate-400">{identity.role}</div></div>
        </div>
      </header>

      <div className="p-4 md:p-8 max-w-[1500px] mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div><h2 className="text-2xl font-black tracking-tight">Good day, {identity.fullName.split(" ")[0]}</h2>
            <p className="text-sm text-slate-500 mt-1">Manage your school workspace from one place.</p></div>
          <span className="pill bg-blue-50 text-blue-700">{identity.role}</span>
        </div>

        {notice && <div className="mb-4 p-3 rounded-xl bg-emerald-50 text-emerald-700 text-sm flex gap-2 items-center"><CheckCircle2 size={17} />{notice}</div>}
        {errorMessage && <div className="mb-4 p-3 rounded-xl bg-rose-50 text-rose-700 text-sm flex gap-2 items-start"><AlertCircle size={17} className="shrink-0 mt-0.5" /><span>{errorMessage}</span><button className="ml-auto" onClick={() => setErrorMessage("")} aria-label="Dismiss error"><X size={16} /></button></div>}

        {active === "Overview" && <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
          <div className="card p-5"><div className="flex justify-between"><span className="text-sm text-slate-500">Classes</span><BookOpen className="text-[#3157d5]" /></div><div className="text-3xl font-black mt-3">{classes.length}</div><p className="text-xs text-slate-400 mt-1">Live records in {identity.schoolName}</p></div>
          <div className="card p-5"><div className="flex justify-between"><span className="text-sm text-slate-500">Registered students</span><Users className="text-[#3157d5]" /></div><div className="text-3xl font-black mt-3">{students.length}</div><p className="text-xs text-slate-400 mt-1">{activeStudents} active students</p></div>
          <div className="card p-5"><div className="flex justify-between"><span className="text-sm text-slate-500">Workspace</span><School className="text-[#3157d5]" /></div><div className="text-lg font-black mt-3">{identity.schoolName}</div><p className="text-xs text-slate-400 mt-1">Authenticated school account</p></div>
          <div className="card p-5 sm:col-span-2 xl:col-span-3"><h3 className="font-bold">Getting started</h3><p className="text-sm text-slate-500 mt-1">Begin by creating your school's classes, then register students into each class.</p><button className="btn btn-primary mt-4" onClick={() => setActive("Classes & Students")}><Users size={16} /> Open Classes & Students</button></div>
        </div>}

        {active === "Classes & Students" && <section className="space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="card p-4"><p className="text-xs text-slate-500">Classes & arms</p><p className="text-2xl font-black mt-2">{classes.length}</p></div>
            <div className="card p-4"><p className="text-xs text-slate-500">All students</p><p className="text-2xl font-black mt-2">{students.length}</p></div>
            <div className="card p-4"><p className="text-xs text-slate-500">Active students</p><p className="text-2xl font-black mt-2">{activeStudents}</p></div>
            <div className="card p-4"><p className="text-xs text-slate-500">Inactive students</p><p className="text-2xl font-black mt-2">{students.length - activeStudents}</p></div>
          </div>

          <div className="card p-5">
            <div className="flex flex-wrap justify-between items-center gap-3 mb-5">
              <div><h3 className="font-bold text-lg">Classes</h3><p className="text-xs text-slate-400 mt-1">Create and maintain class groups for this school.</p></div>
              <div className="flex gap-2">
                <button className="btn btn-light" onClick={() => identity && void loadSchoolRecords(identity.schoolId)} disabled={recordsLoading}><RefreshCw size={15} /> Refresh</button>
                {identity.role === "Admin" && <button className="btn btn-primary" onClick={startNewClass}><Plus size={15} /> Add class</button>}
              </div>
            </div>

            {showClassForm && <form onSubmit={saveClass} className="rounded-2xl border border-blue-100 bg-blue-50/50 p-4 mb-5">
              <div className="flex justify-between items-center mb-3"><h4 className="font-bold">{editingClass ? "Edit class" : "Create class"}</h4><button type="button" onClick={() => setShowClassForm(false)} aria-label="Close class form"><X size={18} /></button></div>
              <div className="grid sm:grid-cols-3 gap-3">
                <div><label className="label">Class name *</label><input className="field" required placeholder="e.g. JSS 1" value={classForm.name} onChange={(e) => setClassForm({ ...classForm, name: e.target.value })} /></div>
                <div><label className="label">Arm</label><input className="field" placeholder="e.g. A (leave blank if none)" value={classForm.arm} onChange={(e) => setClassForm({ ...classForm, arm: e.target.value })} /></div>
                <div><label className="label">Display order</label><input className="field" type="number" placeholder="e.g. 1" value={classForm.level_order} onChange={(e) => setClassForm({ ...classForm, level_order: e.target.value })} /></div>
              </div>
              <div className="flex gap-2 mt-4"><button className="btn btn-primary" type="submit" disabled={savingClass}>{savingClass ? "Saving..." : editingClass ? "Save changes" : "Create class"}</button><button className="btn btn-light" type="button" onClick={() => setShowClassForm(false)}>Cancel</button></div>
            </form>}

            {recordsError && <div className="p-3 rounded-xl bg-rose-50 text-rose-700 text-sm mb-4">{recordsError}</div>}
            {recordsLoading ? <div className="py-10 text-center text-sm text-slate-400">Loading school records...</div> :
              classes.length === 0 ? <div className="py-10 text-center border border-dashed border-slate-200 rounded-2xl"><BookOpen className="mx-auto text-slate-300" size={30} /><h4 className="font-bold mt-3">No classes yet</h4><p className="text-sm text-slate-500 mt-1">Create your first class to begin registering students.</p>{identity.role === "Admin" && <button className="btn btn-primary mt-4" onClick={startNewClass}><Plus size={15} /> Create first class</button>}</div> :
              <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
                {classes.map((item) => <div className={`rounded-2xl border p-4 ${selectedClassId === item.id ? "border-blue-300 bg-blue-50/40" : "border-slate-200"}`} key={item.id}>
                  <div className="flex justify-between items-start gap-2"><div className="w-10 h-10 rounded-xl bg-blue-50 text-[#3157d5] grid place-items-center"><BookOpen size={19} /></div>{identity.role === "Admin" && <button className="p-2 rounded-lg hover:bg-slate-100 text-slate-500" onClick={() => startEditClass(item)} aria-label={`Edit ${item.name} ${item.arm}`}><Pencil size={15} /></button>}</div>
                  <h4 className="font-bold mt-3">{item.name}{item.arm ? ` ${item.arm}` : ""}</h4>
                  <p className="text-xs text-slate-500 mt-1">{classStudentCount(item.id)} student{classStudentCount(item.id) === 1 ? "" : "s"}</p>
                  <button className="text-xs text-[#3157d5] font-bold mt-4" onClick={() => setSelectedClassId(item.id)}>View students →</button>
                </div>)}
              </div>}
          </div>

          <div className="card p-5">
            <div className="flex flex-wrap justify-between items-center gap-3 mb-5">
              <div><h3 className="font-bold text-lg">Students</h3><p className="text-xs text-slate-400 mt-1">Register, search, edit and manage student records.</p></div>
              {identity.role === "Admin" && <button className="btn btn-primary" onClick={startNewStudent} disabled={classes.length === 0}><UserPlus size={15} /> Register student</button>}
            </div>

            {showStudentForm && <form onSubmit={saveStudent} className="rounded-2xl border border-blue-100 bg-blue-50/50 p-4 mb-5">
              <div className="flex justify-between items-center mb-3"><h4 className="font-bold">{editingStudent ? "Edit student record" : "Register new student"}</h4><button type="button" onClick={() => setShowStudentForm(false)} aria-label="Close student form"><X size={18} /></button></div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <div><label className="label">Admission number *</label><input className="field" required value={studentForm.admission_number} onChange={(e) => setStudentForm({ ...studentForm, admission_number: e.target.value })} placeholder="e.g. BDA/2026/001" /></div>
                <div><label className="label">Full name *</label><input className="field" required value={studentForm.full_name} onChange={(e) => setStudentForm({ ...studentForm, full_name: e.target.value })} placeholder="Student's full name" /></div>
                <div><label className="label">Class *</label><select className="field" required value={studentForm.class_id} onChange={(e) => setStudentForm({ ...studentForm, class_id: e.target.value })}><option value="">Select class</option>{classes.map((item) => <option key={item.id} value={item.id}>{item.name}{item.arm ? ` ${item.arm}` : ""}</option>)}</select></div>
                <div><label className="label">Gender</label><select className="field" value={studentForm.gender} onChange={(e) => setStudentForm({ ...studentForm, gender: e.target.value })}><option value="">Not specified</option><option value="Male">Male</option><option value="Female">Female</option><option value="Other">Other</option></select></div>
                <div><label className="label">Date of birth</label><input className="field" type="date" value={studentForm.date_of_birth} onChange={(e) => setStudentForm({ ...studentForm, date_of_birth: e.target.value })} /></div>
                <div><label className="label">Admission date</label><input className="field" type="date" value={studentForm.admitted_on} onChange={(e) => setStudentForm({ ...studentForm, admitted_on: e.target.value })} /></div>
              </div>
              <div className="flex gap-2 mt-4"><button className="btn btn-primary" type="submit" disabled={savingStudent}>{savingStudent ? "Saving..." : editingStudent ? "Save changes" : "Register student"}</button><button className="btn btn-light" type="button" onClick={() => setShowStudentForm(false)}>Cancel</button></div>
            </form>}

            <div className="flex flex-col sm:flex-row gap-3 mb-4">
              <div className="relative flex-1"><Search size={16} className="absolute left-3 top-3 text-slate-400" /><input className="field pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by student name or admission number" /></div>
              <select className="field sm:!w-56" value={selectedClassId} onChange={(e) => setSelectedClassId(e.target.value)}><option value="all">All classes</option>{classes.map((item) => <option key={item.id} value={item.id}>{item.name}{item.arm ? ` ${item.arm}` : ""}</option>)}</select>
            </div>

            {recordsLoading ? <div className="py-8 text-center text-sm text-slate-400">Loading students...</div> :
              students.length === 0 ? <div className="py-10 text-center border border-dashed border-slate-200 rounded-2xl"><Users className="mx-auto text-slate-300" size={30} /><h4 className="font-bold mt-3">No students registered</h4><p className="text-sm text-slate-500 mt-1">Once you create classes, you can register students here.</p></div> :
              filteredStudents.length === 0 ? <div className="py-8 text-center text-sm text-slate-500">No students match this search or class filter.</div> :
              <div className="overflow-x-auto">
                <table className="table w-full">
                  <thead><tr><th>Student</th><th>Admission no.</th><th>Class</th><th>Gender</th><th>Status</th>{identity.role === "Admin" && <th>Actions</th>}</tr></thead>
                  <tbody>{filteredStudents.map((student) => {
                    const studentClass = classes.find((item) => item.id === student.class_id);
                    return <tr key={student.id}>
                      <td className="font-semibold">{student.full_name}</td>
                      <td className="text-slate-500">{student.admission_number}</td>
                      <td>{studentClass ? `${studentClass.name}${studentClass.arm ? ` ${studentClass.arm}` : ""}` : "—"}</td>
                      <td>{student.gender || "—"}</td>
                      <td><span className={`pill ${student.is_active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{student.is_active ? "Active" : "Inactive"}</span></td>
                      {identity.role === "Admin" && <td><div className="flex items-center gap-1">
                        <button className="p-2 rounded-lg text-slate-500 hover:bg-slate-100" onClick={() => startEditStudent(student)} aria-label={`Edit ${student.full_name}`}><Pencil size={15} /></button>
                        <button className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-50" disabled={savingStudentStatus === student.id} onClick={() => void toggleStudentStatus(student)} aria-label={student.is_active ? `Deactivate ${student.full_name}` : `Reactivate ${student.full_name}`}>
                          {student.is_active ? <UserX size={15} /> : <UserCheck size={15} />}
                        </button>
                      </div></td>}
                    </tr>;
                  })}</tbody>
                </table>
                <p className="text-xs text-slate-400 mt-3">Showing {filteredStudents.length} of {students.length} student records.</p>
              </div>}
          </div>
        </section>}

        {active !== "Overview" && active !== "Classes & Students" && <div className="card p-6 max-w-3xl">
          <div className="w-11 h-11 rounded-xl bg-amber-50 text-amber-700 grid place-items-center"><AlertCircle size={20} /></div>
          <h3 className="font-bold text-lg mt-4">{active}</h3>
          <p className="text-sm text-slate-500 mt-2">This module is not connected to live database records yet. The Classes & Students module is now connected to Supabase.</p>
          <button className="btn btn-primary mt-5" onClick={() => setActive("Classes & Students")}><Users size={16} /> Go to Classes & Students</button>
        </div>}

        <footer className="text-center text-[10px] text-slate-400 py-8">© 2026 Klasrum · School, in sync · Progressive Web App</footer>
      </div>
    </main>
  </div>;
}
