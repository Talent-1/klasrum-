-- Klasrum multi-tenant schema. Run in Supabase SQL Editor.
-- IMPORTANT: Set app_metadata.school_id and app_metadata.role from a trusted
-- server/admin workflow. Never let users self-edit app_metadata.
create extension if not exists pgcrypto;

create table if not exists public.schools (
 id uuid primary key default gen_random_uuid(),
 name text not null,
 slug text not null unique,
 created_at timestamptz not null default now()
);

create table if not exists public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 school_id uuid not null references public.schools(id) on delete cascade,
 role text not null check (role in ('admin','teacher','student')),
 full_name text not null,
 email text not null,
 created_at timestamptz not null default now(),
 unique (school_id,id)
);

create table if not exists public.classes (
 id uuid primary key default gen_random_uuid(),
 school_id uuid not null references public.schools(id) on delete cascade,
 name text not null,
 arm text not null,
 created_at timestamptz not null default now(),
 unique (school_id,name,arm),
 unique (school_id,id)
);

create table if not exists public.subjects (
 id uuid primary key default gen_random_uuid(),
 school_id uuid not null references public.schools(id) on delete cascade,
 name text not null,
 created_at timestamptz not null default now(),
 unique (school_id,name),
 unique (school_id,id)
);

create table if not exists public.students (
 id uuid primary key default gen_random_uuid(),
 school_id uuid not null references public.schools(id) on delete cascade,
 profile_id uuid,
 class_id uuid not null,
 admission_number text not null,
 full_name text not null,
 created_at timestamptz not null default now(),
 unique (school_id,admission_number),
 unique (school_id,id),
 foreign key (school_id,class_id) references public.classes(school_id,id) on delete restrict,
 foreign key (school_id,profile_id) references public.profiles(school_id,id) on delete set null (profile_id)
);

create table if not exists public.teacher_assignments (
 id uuid primary key default gen_random_uuid(),
 school_id uuid not null references public.schools(id) on delete cascade,
 teacher_id uuid not null,
 class_id uuid not null,
 subject_id uuid,
 is_form_teacher boolean not null default false,
 created_at timestamptz not null default now(),
 foreign key (school_id,teacher_id) references public.profiles(school_id,id) on delete cascade,
 foreign key (school_id,class_id) references public.classes(school_id,id) on delete cascade,
 foreign key (school_id,subject_id) references public.subjects(school_id,id) on delete cascade,
 check (subject_id is not null or is_form_teacher),
 unique (school_id,teacher_id,class_id,subject_id)
);

create table if not exists public.academic_terms (
 id uuid primary key default gen_random_uuid(),
 school_id uuid not null references public.schools(id) on delete cascade,
 session text not null,
 term text not null check(term in ('First Term','Second Term','Third Term')),
 is_published boolean not null default false,
 published_at timestamptz,
 created_at timestamptz not null default now(),
 unique (school_id,session,term),
 unique (school_id,id)
);

create table if not exists public.scores (
 id uuid primary key default gen_random_uuid(),
 school_id uuid not null references public.schools(id) on delete cascade,
 student_id uuid not null,
 subject_id uuid not null,
 academic_term_id uuid not null,
 ca_score numeric(5,2) not null default 0 check(ca_score between 0 and 30),
 exam_score numeric(5,2) not null default 0 check(exam_score between 0 and 70),
 total_score numeric(5,2) generated always as (ca_score + exam_score) stored,
 teacher_comment text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 foreign key (school_id,student_id) references public.students(school_id,id) on delete cascade,
 foreign key (school_id,subject_id) references public.subjects(school_id,id) on delete restrict,
 foreign key (school_id,academic_term_id) references public.academic_terms(school_id,id) on delete cascade,
 unique(school_id,student_id,subject_id,academic_term_id)
);

create table if not exists public.attendance (
 id uuid primary key default gen_random_uuid(),
 school_id uuid not null references public.schools(id) on delete cascade,
 student_id uuid not null,
 attendance_date date not null default current_date,
 status text not null check(status in ('present','absent','late','excused')),
 marked_by uuid not null,
 created_at timestamptz not null default now(),
 foreign key (school_id,student_id) references public.students(school_id,id) on delete cascade,
 foreign key (school_id,marked_by) references public.profiles(school_id,id) on delete restrict,
 unique(school_id,student_id,attendance_date)
);

create table if not exists public.student_reports (
 id uuid primary key default gen_random_uuid(),
 school_id uuid not null references public.schools(id) on delete cascade,
 student_id uuid not null,
 academic_term_id uuid not null,
 form_teacher_comment text,
 principal_comment text,
 conduct jsonb not null default '{}'::jsonb,
 days_present integer not null default 0,
 days_absent integer not null default 0,
 created_at timestamptz not null default now(),
 foreign key (school_id,student_id) references public.students(school_id,id) on delete cascade,
 foreign key (school_id,academic_term_id) references public.academic_terms(school_id,id) on delete cascade,
 unique(school_id,student_id,academic_term_id)
);

-- Store only a hash of the PIN. The plaintext is shown once at generation time.
create table if not exists public.scratch_cards (
 id uuid primary key default gen_random_uuid(),
 school_id uuid not null references public.schools(id) on delete cascade,
 academic_term_id uuid not null,
 pin_hash text not null,
 serial_number text not null,
 is_used boolean not null default false,
 used_by_student_id uuid,
 used_at timestamptz,
 created_at timestamptz not null default now(),
 foreign key (school_id,academic_term_id) references public.academic_terms(school_id,id) on delete cascade,
 foreign key (school_id,used_by_student_id) references public.students(school_id,id) on delete set null,
 unique(school_id,serial_number)
);

create index if not exists idx_students_class on public.students(school_id,class_id);
create index if not exists idx_scores_term_student on public.scores(school_id,academic_term_id,student_id);
create index if not exists idx_attendance_date_class on public.attendance(school_id,attendance_date);

-- Tenant identity must come from trusted app_metadata, not user_metadata.
-- user_metadata is editable by the account owner and is NOT safe for authorization.
create or replace function public.current_school_id()
returns uuid language sql stable security invoker
as $$ select nullif(auth.jwt() -> 'app_metadata' ->> 'school_id','')::uuid $$;

create or replace function public.current_role()
returns text language sql stable security invoker
as $$ select auth.jwt() -> 'app_metadata' ->> 'role' $$;

create or replace function public.is_school_admin()
returns boolean language sql stable security invoker
as $$ select public.current_role() = 'admin' $$;

-- Enable RLS and enforce school isolation on every tenant-owned table.
do $$
declare t text;
begin
 foreach t in array array['profiles','classes','subjects','students','teacher_assignments',
 'academic_terms','scores','attendance','student_reports','scratch_cards']
 loop
  execute format('alter table public.%I enable row level security',t);
  execute format('drop policy if exists tenant_select on public.%I',t);
  execute format('create policy tenant_select on public.%I for select using (school_id = public.current_school_id())',t);
  execute format('drop policy if exists tenant_insert on public.%I',t);
  execute format('create policy tenant_insert on public.%I for insert with check (school_id = public.current_school_id() and public.is_school_admin())',t);
  execute format('drop policy if exists tenant_update on public.%I',t);
  execute format('create policy tenant_update on public.%I for update using (school_id = public.current_school_id() and public.is_school_admin()) with check (school_id = public.current_school_id() and public.is_school_admin())',t);
  execute format('drop policy if exists tenant_delete on public.%I',t);
  execute format('create policy tenant_delete on public.%I for delete using (school_id = public.current_school_id() and public.is_school_admin())',t);
 end loop;
end $$;

alter table public.schools enable row level security;
drop policy if exists school_read_own on public.schools;
create policy school_read_own on public.schools for select using (id = public.current_school_id());
-- School creation/update should be service-role-only; do not expose broad client policies.

-- Teacher-specific write permissions: only assigned teachers may enter scores or attendance.
drop policy if exists teacher_score_insert on public.scores;
create policy teacher_score_insert on public.scores for insert with check (
 school_id = public.current_school_id() and (
  public.is_school_admin() or exists (
   select 1 from public.teacher_assignments a
   where a.school_id=scores.school_id and a.teacher_id=auth.uid()
     and a.class_id=(select s.class_id from public.students s where s.id=scores.student_id and s.school_id=scores.school_id)
     and a.subject_id=scores.subject_id
  )
 )
);
drop policy if exists teacher_score_update on public.scores;
create policy teacher_score_update on public.scores for update using (
 school_id=public.current_school_id() and (
  public.is_school_admin() or exists (
   select 1 from public.teacher_assignments a
   where a.school_id=scores.school_id and a.teacher_id=auth.uid()
     and a.class_id=(select s.class_id from public.students s where s.id=scores.student_id and s.school_id=scores.school_id)
     and a.subject_id=scores.subject_id
  )
 )
) with check (school_id=public.current_school_id());

drop policy if exists teacher_attendance_insert on public.attendance;
create policy teacher_attendance_insert on public.attendance for insert with check (
 school_id=public.current_school_id() and (
  public.is_school_admin() or exists (
   select 1 from public.teacher_assignments a
   join public.students s on s.school_id=a.school_id and s.class_id=a.class_id
   where a.school_id=attendance.school_id and a.teacher_id=auth.uid()
     and a.is_form_teacher=true and s.id=attendance.student_id
  )
 )
);

-- Student access: authenticated student can read only their own student row and
-- published-term results. PostgreSQL permissive policies are OR-combined, so remove
-- the broad tenant-only SELECT policies from these sensitive tables first.
drop policy if exists tenant_select on public.students;
drop policy if exists tenant_select on public.scores;
drop policy if exists student_own_student on public.students;
create policy student_own_student on public.students for select using (
 school_id=public.current_school_id() and (public.is_school_admin() or profile_id=auth.uid())
);
drop policy if exists student_scores_published on public.scores;
create policy student_scores_published on public.scores for select using (
 school_id=public.current_school_id() and (
  public.current_role() in ('admin','teacher') or (
   exists(select 1 from public.students s where s.id=scores.student_id and s.profile_id=auth.uid() and s.school_id=scores.school_id)
   and exists(select 1 from public.academic_terms t where t.id=scores.academic_term_id and t.school_id=scores.school_id and t.is_published)
  )
 )
);


drop policy if exists student_reports_read on public.student_reports;
create policy student_reports_read on public.student_reports for select using (
 school_id=public.current_school_id() and (
  public.current_role() in ('admin','teacher') or exists(
   select 1 from public.students s where s.id=student_reports.student_id
   and s.school_id=student_reports.school_id and s.profile_id=auth.uid()
  )
 )
);

-- Scratch-card lookup/use MUST be performed through a server-side Edge Function or
-- SECURITY DEFINER RPC with rate limiting. Never grant students direct SELECT on cards.
revoke all on public.scratch_cards from anon, authenticated;
grant select, insert, update, delete on public.scratch_cards to service_role;

-- NOTE: Remove/replace the generic tenant_select policies for tables whose access
-- needs additional role restrictions before production. Keep all writes server-mediated
-- where business rules require publishing, card consumption, or privileged role changes.
