-- KLASRUM — Migration 001: Core schema
-- Target: a NEW Supabase project. Run migrations in numeric order.
-- This migration creates the core multi-tenant data model.
-- It does not create client-side authentication users; provision users through
-- a trusted server/Edge Function using the Supabase Auth Admin API.

begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
alter extension pgcrypto set schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- School and identity
-- ---------------------------------------------------------------------------

create table public.schools (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  slug text not null unique check (slug = lower(slug)),
  logo_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete restrict,
  role text not null check (role in ('admin','teacher','student')),
  full_name text not null check (length(trim(full_name)) > 0),
  email text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, id)
);

-- One row represents one exact class AND arm (e.g. JSS 1 / A).
create table public.classes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete restrict,
  name text not null,
  arm text not null default '',
  level_order integer,
  created_at timestamptz not null default now(),
  unique (school_id, id),
  unique (school_id, name, arm)
);

create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete restrict,
  name text not null,
  short_code text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (school_id, id),
  unique (school_id, name),
  unique (school_id, short_code)
);

create table public.academic_sessions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete restrict,
  name text not null,
  starts_on date,
  ends_on date,
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  unique (school_id, id),
  unique (school_id, name),
  check (starts_on is null or ends_on is null or starts_on <= ends_on)
);
create unique index uq_one_current_session_per_school
  on public.academic_sessions(school_id) where is_current;

create table public.academic_terms (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete restrict,
  session_id uuid not null,
  term_name text not null check (term_name in ('First Term','Second Term','Third Term')),
  starts_on date,
  ends_on date,
  status text not null default 'draft'
    check (status in ('draft','open','published','closed')),
  published_at timestamptz,
  published_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, id),
  unique (school_id, session_id, term_name),
  foreign key (school_id, session_id)
    references public.academic_sessions(school_id, id) on delete restrict,
  foreign key (school_id, published_by)
    references public.profiles(school_id, id) on delete restrict,
  check (starts_on is null or ends_on is null or starts_on <= ends_on)
);

-- Score maxima and grade bands are school-configurable, but changes are
-- recorded in the audit stream in migration 002. Defaults: CA 30 + exam 70.
create table public.grading_scales (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete restrict,
  name text not null default 'Default',
  ca_max numeric(6,2) not null default 30 check (ca_max > 0),
  exam_max numeric(6,2) not null default 70 check (exam_max > 0),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (school_id, id),
  unique (school_id, name)
);
create unique index uq_one_default_grading_scale
  on public.grading_scales(school_id) where is_default;

create table public.grade_bands (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  grading_scale_id uuid not null,
  grade text not null,
  remark text,
  min_score numeric(6,2) not null check (min_score >= 0),
  max_score numeric(6,2) not null check (max_score > min_score),
  unique (school_id, id),
  unique (school_id, grading_scale_id, grade),
  foreign key (school_id, grading_scale_id)
    references public.grading_scales(school_id, id) on delete cascade
);

-- Students are not auth users by default. profile_id is optional for a future
-- student login; parent accounts/links can be added in a later migration.
create table public.students (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete restrict,
  profile_id uuid,
  class_id uuid not null,
  admission_number text not null,
  full_name text not null,
  gender text,
  date_of_birth date,
  is_active boolean not null default true,
  admitted_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, id),
  unique (school_id, admission_number),
  foreign key (school_id, class_id)
    references public.classes(school_id, id) on delete restrict,
  foreign key (school_id, profile_id)
    references public.profiles(school_id, id) on delete restrict
);
create unique index uq_student_profile_per_school
  on public.students(school_id, profile_id) where profile_id is not null;

-- subject_id NULL + is_form_teacher=true means a form-teacher assignment.
-- subject_id NOT NULL + is_form_teacher=false means a subject assignment.
create table public.teacher_assignments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete restrict,
  teacher_id uuid not null,
  class_id uuid not null,
  subject_id uuid,
  is_form_teacher boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (school_id, teacher_id)
    references public.profiles(school_id, id) on delete restrict,
  foreign key (school_id, class_id)
    references public.classes(school_id, id) on delete restrict,
  foreign key (school_id, subject_id)
    references public.subjects(school_id, id) on delete restrict,
  check (
    (is_form_teacher = true and subject_id is null)
    or
    (is_form_teacher = false and subject_id is not null)
  ),
  unique (school_id, id)
);
create unique index uq_subject_assignment
  on public.teacher_assignments(school_id, teacher_id, class_id, subject_id)
  where subject_id is not null;
create unique index uq_one_form_teacher_per_class
  on public.teacher_assignments(school_id, class_id)
  where is_form_teacher;

-- ---------------------------------------------------------------------------
-- Academic source records
-- ---------------------------------------------------------------------------

create table public.scores (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete restrict,
  student_id uuid not null,
  class_id uuid not null,
  subject_id uuid not null,
  term_id uuid not null,
  grading_scale_id uuid not null,
  ca_score numeric(6,2) not null,
  exam_score numeric(6,2) not null,
  submitted_by uuid not null,
  last_modified_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, id),
  unique (school_id, student_id, subject_id, term_id),
  foreign key (school_id, student_id)
    references public.students(school_id, id) on delete restrict,
  foreign key (school_id, class_id)
    references public.classes(school_id, id) on delete restrict,
  foreign key (school_id, subject_id)
    references public.subjects(school_id, id) on delete restrict,
  foreign key (school_id, term_id)
    references public.academic_terms(school_id, id) on delete restrict,
  foreign key (school_id, grading_scale_id)
    references public.grading_scales(school_id, id) on delete restrict,
  foreign key (school_id, submitted_by)
    references public.profiles(school_id, id) on delete restrict,
  foreign key (school_id, last_modified_by)
    references public.profiles(school_id, id) on delete restrict
);

create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete restrict,
  student_id uuid not null,
  class_id uuid not null,
  term_id uuid not null,
  attendance_date date not null,
  status text not null check (status in ('present','absent','late','excused')),
  marked_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, id),
  unique (school_id, student_id, attendance_date),
  foreign key (school_id, student_id)
    references public.students(school_id, id) on delete restrict,
  foreign key (school_id, class_id)
    references public.classes(school_id, id) on delete restrict,
  foreign key (school_id, term_id)
    references public.academic_terms(school_id, id) on delete restrict,
  foreign key (school_id, marked_by)
    references public.profiles(school_id, id) on delete restrict
);

-- Comments are deliberately separated from scores and calculated grades.
create table public.student_comments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete restrict,
  student_id uuid not null,
  class_id uuid not null,
  term_id uuid not null,
  form_teacher_comment text,
  conduct jsonb not null default '{}'::jsonb,
  entered_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, id),
  unique (school_id, student_id, term_id),
  foreign key (school_id, student_id)
    references public.students(school_id, id) on delete restrict,
  foreign key (school_id, class_id)
    references public.classes(school_id, id) on delete restrict,
  foreign key (school_id, term_id)
    references public.academic_terms(school_id, id) on delete restrict,
  foreign key (school_id, entered_by)
    references public.profiles(school_id, id) on delete restrict
);

create table public.principal_comments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete restrict,
  student_id uuid not null,
  class_id uuid not null,
  term_id uuid not null,
  comment text,
  entered_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, id),
  unique (school_id, student_id, term_id),
  foreign key (school_id, student_id)
    references public.students(school_id, id) on delete restrict,
  foreign key (school_id, class_id)
    references public.classes(school_id, id) on delete restrict,
  foreign key (school_id, term_id)
    references public.academic_terms(school_id, id) on delete restrict,
  foreign key (school_id, entered_by)
    references public.profiles(school_id, id) on delete restrict
);

-- Append-only event records. Authenticated clients receive no write grants.
create table public.audit_events (
  id bigint generated always as identity primary key,
  school_id uuid not null,
  actor_id uuid,
  event_type text not null,
  table_name text not null,
  record_id uuid,
  reason text,
  old_data jsonb,
  new_data jsonb,
  occurred_at timestamptz not null default now()
);

create table public.result_publications (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete restrict,
  term_id uuid not null,
  class_id uuid not null,
  version integer not null check (version > 0),
  verification_code text not null unique,
  published_by uuid not null,
  published_at timestamptz not null default now(),
  snapshot jsonb not null default '{}'::jsonb,
  snapshot_hash text not null default '',
  is_current boolean not null default true,
  unique (school_id, id),
  unique (school_id, term_id, class_id, version),
  foreign key (school_id, term_id)
    references public.academic_terms(school_id, id) on delete restrict,
  foreign key (school_id, class_id)
    references public.classes(school_id, id) on delete restrict,
  foreign key (school_id, published_by)
    references public.profiles(school_id, id) on delete restrict
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index idx_profiles_school_role on public.profiles(school_id, role);
create index idx_students_school_class on public.students(school_id, class_id);
create index idx_assignments_teacher on public.teacher_assignments(school_id, teacher_id, class_id);
create index idx_scores_term_class on public.scores(school_id, term_id, class_id);
create index idx_scores_subject_term on public.scores(school_id, subject_id, term_id);
create index idx_attendance_class_date on public.attendance(school_id, class_id, attendance_date);
create index idx_audit_school_time on public.audit_events(school_id, occurred_at desc);
create index idx_publications_lookup on public.result_publications(school_id, term_id, class_id, is_current);
create unique index uq_one_current_publication_per_class_term
  on public.result_publications(school_id, term_id, class_id) where is_current;

commit;
