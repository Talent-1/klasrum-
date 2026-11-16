-- KLASRUM — Migration 002: RLS, controlled workflows, audit and read models
-- Run only after 001_core_schema.sql.
-- SECURITY DEFINER functions below use fixed search_path and explicit checks.
-- Never expose the Supabase service_role key in a browser or mobile app.

begin;

-- ---------------------------------------------------------------------------
-- JWT identity helpers. Authorization uses app_metadata, never user_metadata.
-- ---------------------------------------------------------------------------

create or replace function private.jwt_school_id()
returns uuid
language sql stable
set search_path = ''
as $$
  select nullif(auth.jwt() -> 'app_metadata' ->> 'school_id','')::uuid
$$;

create or replace function private.jwt_role()
returns text
language sql stable
set search_path = ''
as $$
  select auth.jwt() -> 'app_metadata' ->> 'role'
$$;

create or replace function private.is_school_admin(p_school_id uuid)
returns boolean
language sql stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
     and private.jwt_school_id() = p_school_id
     and private.jwt_role() = 'admin'
     and exists (select 1 from public.profiles p
       where p.id=auth.uid() and p.school_id=p_school_id
         and p.role='admin' and p.is_active)
$$;

create or replace function private.is_form_teacher(p_school_id uuid, p_class_id uuid)
returns boolean
language sql stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1 from public.teacher_assignments a
    where a.school_id = p_school_id
      and a.teacher_id = auth.uid()
      and a.class_id = p_class_id
      and a.is_form_teacher
      and exists (select 1 from public.profiles p where p.id=a.teacher_id
        and p.school_id=a.school_id and p.role='teacher' and p.is_active)
  )
$$;

create or replace function private.teaches_subject(
  p_school_id uuid, p_class_id uuid, p_subject_id uuid
)
returns boolean
language sql stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1 from public.teacher_assignments a
    where a.school_id = p_school_id
      and a.teacher_id = auth.uid()
      and a.class_id = p_class_id
      and a.subject_id = p_subject_id
      and not a.is_form_teacher
      and exists (select 1 from public.profiles p where p.id=a.teacher_id
        and p.school_id=a.school_id and p.role='teacher' and p.is_active)
  )
$$;

create or replace function private.can_view_student(p_school_id uuid, p_class_id uuid, p_student_id uuid)
returns boolean
language sql stable
security invoker
set search_path = ''
as $$
  select (
    private.is_school_admin(p_school_id)
    or private.is_form_teacher(p_school_id,p_class_id)
    or exists (
      select 1 from public.teacher_assignments a
      where a.school_id = p_school_id and a.teacher_id = auth.uid()
        and a.class_id = p_class_id and a.subject_id is not null
        and exists (select 1 from public.profiles p where p.id=a.teacher_id
          and p.school_id=a.school_id and p.role='teacher' and p.is_active)
    )
  )
      
$$;

-- ---------------------------------------------------------------------------
-- Timestamp and integrity triggers
-- ---------------------------------------------------------------------------

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'schools','profiles','academic_terms','students','scores',
    'attendance','student_comments','principal_comments'
  ] loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function private.set_updated_at()',
      'trg_'||t||'_updated_at', t
    );
  end loop;
end $$;

-- Ensure a score's class matches the student's current class, the subject and
-- term belong to the same school, and submitted_by is a teacher profile.
create or replace function private.validate_score_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_class uuid;
  v_role text;
  v_ca numeric(6,2);
  v_exam numeric(6,2);
begin
  select s.class_id into v_class
  from public.students s
  where s.school_id = new.school_id and s.id = new.student_id;

  if v_class is null or v_class <> new.class_id then
    raise exception 'Score class must match the student class.';
  end if;

  if tg_op='INSERT' then
    select p.role into v_role
    from public.profiles p
    where p.school_id = new.school_id and p.id = new.submitted_by and p.is_active;
    if v_role is distinct from 'teacher' then
      raise exception 'Only an active teacher can submit a score.';
    end if;
  end if;

  select p.role into v_role
  from public.profiles p
  where p.school_id = new.school_id and p.id = new.last_modified_by and p.is_active;
  if v_role is distinct from 'teacher' then
    raise exception 'The latest score editor must be an active teacher.';
  end if;

  select gs.ca_max, gs.exam_max into v_ca, v_exam
  from public.grading_scales gs
  where gs.school_id = new.school_id and gs.id = new.grading_scale_id;

  if v_ca is null or v_exam is null then
    raise exception 'A valid grading scale is required.';
  end if;
  if new.ca_score < 0 or new.ca_score > v_ca
     or new.exam_score < 0 or new.exam_score > v_exam then
    raise exception 'Score is outside the configured maximum.';
  end if;

  if tg_op = 'UPDATE' then
    if new.school_id <> old.school_id
       or new.student_id <> old.student_id
       or new.class_id <> old.class_id
       or new.subject_id <> old.subject_id
       or new.term_id <> old.term_id
       or new.grading_scale_id <> old.grading_scale_id
       or new.submitted_by <> old.submitted_by then
      raise exception 'Score identity and ownership fields are immutable.';
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_validate_score
before insert or update on public.scores
for each row execute function private.validate_score_row();

create or replace function private.validate_class_scoped_record()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student_class uuid;
  v_term_school uuid;
  v_actor_role text;
begin
  if tg_op = 'UPDATE' then
    if new.school_id <> old.school_id
       or new.student_id <> old.student_id
       or new.class_id <> old.class_id
       or new.term_id <> old.term_id then
      raise exception 'Record identity and class ownership are immutable.';
    end if;
  end if;

  select s.class_id into v_student_class
  from public.students s
  where s.school_id = new.school_id and s.id = new.student_id;

  if v_student_class is null or v_student_class <> new.class_id then
    raise exception 'The student must belong to the selected class and arm.';
  end if;

  select t.school_id into v_term_school
  from public.academic_terms t
  where t.school_id = new.school_id and t.id = new.term_id;

  if v_term_school is null then
    raise exception 'The academic term does not belong to this school.';
  end if;

  if tg_table_name = 'attendance' then
    select p.role into v_actor_role
    from public.profiles p
    where p.school_id = new.school_id and p.id = new.marked_by and p.is_active;
    if v_actor_role is distinct from 'teacher' then
      raise exception 'Attendance must be recorded by an active teacher.';
    end if;
  elsif tg_table_name = 'student_comments' then
    select p.role into v_actor_role
    from public.profiles p
    where p.school_id = new.school_id and p.id = new.entered_by and p.is_active;
    if v_actor_role is distinct from 'teacher' then
      raise exception 'Form-teacher comments must be entered by an active teacher.';
    end if;
  elsif tg_table_name = 'principal_comments' then
    select p.role into v_actor_role
    from public.profiles p
    where p.school_id = new.school_id and p.id = new.entered_by and p.is_active;
    if v_actor_role is distinct from 'admin' or new.entered_by is distinct from auth.uid() then
      raise exception 'Principal comments must be entered by the active school administrator.';
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_validate_attendance_context
before insert or update on public.attendance
for each row execute function private.validate_class_scoped_record();

create trigger trg_validate_student_comment_context
before insert or update on public.student_comments
for each row execute function private.validate_class_scoped_record();

create trigger trg_validate_principal_comment_context
before insert or update on public.principal_comments
for each row execute function private.validate_class_scoped_record();

create or replace function private.validate_assignment_teacher()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_role text;
begin
  select p.role into v_role
  from public.profiles p
  where p.school_id=new.school_id and p.id=new.teacher_id and p.is_active;
  if v_role is distinct from 'teacher' then
    raise exception 'Assignments must belong to an active teacher profile.';
  end if;
  return new;
end;
$$;

create trigger trg_validate_assignment_teacher
before insert or update on public.teacher_assignments
for each row execute function private.validate_assignment_teacher();

create or replace function private.prevent_used_grading_scale_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.scores sc
    where sc.school_id=old.school_id and sc.grading_scale_id=old.id) then
    if tg_op='DELETE' then
      raise exception 'A grading scale used by scores cannot be deleted.';
    end if;
    if new.id is distinct from old.id
       or new.school_id is distinct from old.school_id
       or new.ca_max is distinct from old.ca_max
       or new.exam_max is distinct from old.exam_max then
      raise exception 'Score maximums and identity are locked after a grading scale is used. Create a new scale.';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

create trigger trg_lock_used_grading_scale
before update or delete on public.grading_scales
for each row execute function private.prevent_used_grading_scale_change();

create trigger trg_lock_used_grade_bands
before update or delete on public.grade_bands
for each row execute function private.prevent_used_grading_scale_change();

-- Append score history. The actor/reason are set by the controlled RPC.
create or replace function private.audit_score_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_reason text;
begin
  v_actor := auth.uid();
  if v_actor is null then
    v_actor := coalesce(new.last_modified_by, old.last_modified_by);
  end if;

  insert into public.audit_events(
    school_id, actor_id, event_type, table_name, record_id,
    reason, old_data, new_data
  )
  values (
    coalesce(new.school_id,old.school_id),
    v_actor,
    case when tg_op = 'INSERT' then 'score_submitted' else 'score_corrected' end,
    'scores',
    coalesce(new.id,old.id),
    nullif(current_setting('klasrum.score_reason',true),''),
    case when tg_op = 'INSERT' then null else
      jsonb_build_object('ca_score',old.ca_score,'exam_score',old.exam_score,
                         'submitted_by',old.submitted_by,'updated_at',old.updated_at) end,
    case when tg_op = 'DELETE' then null else
      jsonb_build_object('ca_score',new.ca_score,'exam_score',new.exam_score,
                         'submitted_by',new.submitted_by,'last_modified_by',new.last_modified_by,
                         'updated_at',new.updated_at) end
  );
  return new;
end;
$$;

create trigger trg_audit_score
after insert or update on public.scores
for each row execute function private.audit_score_change();

-- Prevent physical deletion of scores and audit/publication history.
create or replace function private.reject_protected_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'This record is protected and cannot be physically deleted.';
end;
$$;
create trigger trg_scores_no_delete before delete on public.scores
for each row execute function private.reject_protected_delete();
create trigger trg_audit_no_update_delete before update or delete on public.audit_events
for each row execute function private.reject_protected_delete();
create or replace function private.protect_publication_history()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Publication history cannot be deleted.';
  end if;
  if new.id <> old.id
     or new.snapshot is distinct from old.snapshot
     or new.school_id <> old.school_id
     or new.term_id <> old.term_id
     or new.class_id <> old.class_id
     or new.version <> old.version
     or new.verification_code <> old.verification_code
     or new.published_by <> old.published_by
     or new.published_at <> old.published_at
     or new.snapshot_hash is distinct from old.snapshot_hash
     or (old.is_current = false and new.is_current = true) then
    raise exception 'Published result details are immutable.';
  end if;
  return new;
end;
$$;
create trigger trg_publications_protect_history
before update or delete on public.result_publications
for each row execute function private.protect_publication_history();

-- ---------------------------------------------------------------------------
-- Controlled score submission/correction RPC
-- ---------------------------------------------------------------------------

create or replace function public.save_subject_score(
  p_student_id uuid,
  p_subject_id uuid,
  p_term_id uuid,
  p_ca_score numeric,
  p_exam_score numeric,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_school uuid;
  v_class uuid;
  v_scale uuid;
  v_score_id uuid;
  v_term_status text;
  v_existing boolean := false;
begin
  v_school := private.jwt_school_id();

  if auth.uid() is null or private.jwt_role() <> 'teacher' or v_school is null then
    raise exception 'Only an authenticated teacher can submit scores.';
  end if;

  select s.class_id into v_class
  from public.students s
  where s.school_id = v_school and s.id = p_student_id and s.is_active;

  if v_class is null then
    raise exception 'Student not found in your school.';
  end if;

  if not private.teaches_subject(v_school,v_class,p_subject_id) then
    raise exception 'You are not assigned to this subject and class.';
  end if;

  select t.status into v_term_status
  from public.academic_terms t
  where t.school_id = v_school and t.id = p_term_id;

  if v_term_status is distinct from 'open' then
    raise exception 'This term is not open for score entry or correction.';
  end if;

  select gs.id into v_scale
  from public.grading_scales gs
  where gs.school_id = v_school and gs.is_default
  limit 1;

  if v_scale is null then
    raise exception 'The school has not configured a default grading scale.';
  end if;

  select exists (select 1 from public.scores sc
    where sc.school_id=v_school and sc.student_id=p_student_id
      and sc.subject_id=p_subject_id and sc.term_id=p_term_id) into v_existing;

  if v_existing and nullif(trim(coalesce(p_reason,'')),'') is null then
    raise exception 'A reason is required when correcting an existing score.';
  end if;

  perform set_config('klasrum.score_reason',
    case when v_existing then trim(p_reason) else 'Initial score submission' end,true);

  insert into public.scores(
    school_id,student_id,class_id,subject_id,term_id,grading_scale_id,
    ca_score,exam_score,submitted_by,last_modified_by
  )
  values (
    v_school,p_student_id,v_class,p_subject_id,p_term_id,v_scale,
    p_ca_score,p_exam_score,auth.uid(),auth.uid()
  )
  on conflict (school_id,student_id,subject_id,term_id)
  do update set
    ca_score = excluded.ca_score,
    exam_score = excluded.exam_score,
    last_modified_by = auth.uid(),
    updated_at = now()
  returning id into v_score_id;

  return v_score_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Publication workflow
-- Admin opens/closes terms and publishes class result versions.
-- Admin never receives a score-write path.
-- ---------------------------------------------------------------------------

drop function if exists public.set_term_status(uuid,text);
create or replace function public.set_term_status(
  p_term_id uuid, p_status text, p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_school uuid := private.jwt_school_id();
  v_old text;
begin
  if not private.is_school_admin(v_school) then
    raise exception 'Only the school administrator can manage term status.';
  end if;
  if p_status not in ('draft','open','published','closed') then
    raise exception 'Invalid term status.';
  end if;
  select status into v_old from public.academic_terms
  where school_id=v_school and id=p_term_id for update;
  if not found then raise exception 'Term not found.'; end if;
  if v_old = p_status then return; end if;

  if not (
    (v_old='draft' and p_status='open')
    or (v_old='open' and p_status='closed')
    or (v_old='published' and p_status in ('open','closed'))
    or (v_old='closed' and p_status='open')
  ) then
    raise exception 'Invalid term transition from % to %.',v_old,p_status;
  end if;
  if v_old in ('published','closed') and p_status='open'
     and nullif(trim(coalesce(p_reason,'')),'') is null then
    raise exception 'A reason is required to reopen a published or closed term.';
  end if;

  if p_status='open' and v_old in ('published','closed') then
    update public.result_publications set is_current=false
    where school_id=v_school and term_id=p_term_id and is_current;
  end if;

  update public.academic_terms
  set status=p_status,
      published_at=case when p_status='published' then now() else published_at end,
      published_by=case when p_status='published' then auth.uid() else published_by end
  where school_id=v_school and id=p_term_id;

  insert into public.audit_events(
    school_id,actor_id,event_type,table_name,record_id,reason,old_data,new_data
  ) values (
    v_school,auth.uid(),'term_status_changed','academic_terms',p_term_id,
    nullif(trim(coalesce(p_reason,'')),''),
    jsonb_build_object('status',v_old),jsonb_build_object('status',p_status)
  );
end;
$$;

drop function if exists public.publish_class_result(uuid,uuid,text);
create or replace function public.publish_class_result(
  p_term_id uuid, p_class_id uuid, p_snapshot_hash text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_school uuid := private.jwt_school_id();
  v_version integer;
  v_code text;
  v_snapshot jsonb;
  v_hash text;
  v_subject_count integer;
  v_student_count integer;
  v_missing integer;
begin
  if not private.is_school_admin(v_school) then
    raise exception 'Only the school administrator can publish results.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_school::text||p_term_id::text||p_class_id::text,0));

  if not exists (select 1 from public.academic_terms t
    where t.school_id=v_school and t.id=p_term_id and t.status in ('open','published')) then
    raise exception 'The term must be open before publishing or republishing.';
  end if;
  if not exists (select 1 from public.classes c
    where c.school_id=v_school and c.id=p_class_id) then
    raise exception 'Class not found.';
  end if;

  select count(distinct subject_id) into v_subject_count
  from public.teacher_assignments
  where school_id=v_school and class_id=p_class_id and subject_id is not null;
  if v_subject_count=0 then
    raise exception 'No subjects are assigned to this class. Configure subject assignments first.';
  end if;
  select count(*) into v_student_count from public.students
  where school_id=v_school and class_id=p_class_id and is_active;
  if v_student_count=0 then raise exception 'There are no active students in this class.'; end if;

  select count(*) into v_missing
  from public.students st
  cross join (select distinct subject_id from public.teacher_assignments
    where school_id=v_school and class_id=p_class_id and subject_id is not null) req
  left join public.scores sc on sc.school_id=v_school and sc.student_id=st.id
    and sc.class_id=p_class_id and sc.subject_id=req.subject_id and sc.term_id=p_term_id
  where st.school_id=v_school and st.class_id=p_class_id and st.is_active
    and sc.id is null;
  if v_missing>0 then
    raise exception 'Cannot publish: % student-subject score entries are missing.',v_missing;
  end if;

  select jsonb_build_object(
    'school_id',v_school,'term_id',p_term_id,'class_id',p_class_id,
    'created_at',now(),
    'rows',coalesce(jsonb_agg(to_jsonb(b) order by b.student_name,b.subject_name),'[]'::jsonb)
  ) into v_snapshot
  from public.get_class_broadsheet(p_class_id,p_term_id) b;
  if v_snapshot is null then raise exception 'Could not build the result snapshot.'; end if;
  v_hash := encode(extensions.digest(convert_to(v_snapshot::text,'UTF8'),'sha256'),'hex');
  v_code := upper(encode(extensions.gen_random_bytes(16),'hex'));

  select coalesce(max(version),0)+1 into v_version
  from public.result_publications
  where school_id=v_school and term_id=p_term_id and class_id=p_class_id;

  update public.result_publications set is_current=false
  where school_id=v_school and term_id=p_term_id and class_id=p_class_id and is_current;

  insert into public.result_publications(
    school_id,term_id,class_id,version,verification_code,published_by,
    snapshot,snapshot_hash,is_current
  ) values (
    v_school,p_term_id,p_class_id,v_version,v_code,auth.uid(),v_snapshot,v_hash,true
  );

  update public.academic_terms set status='published',published_at=now(),published_by=auth.uid()
  where school_id=v_school and id=p_term_id;

  insert into public.audit_events(
    school_id,actor_id,event_type,table_name,reason,new_data
  ) values (
    v_school,auth.uid(),'class_result_published','result_publications',
    'Published immutable result snapshot',
    jsonb_build_object('term_id',p_term_id,'class_id',p_class_id,
      'version',v_version,'verification_code',v_code,'snapshot_hash',v_hash)
  );
  return v_code;
end;
$$;

-- ---------------------------------------------------------------------------
-- Read-only calculation surfaces
-- ---------------------------------------------------------------------------

create or replace view public.subject_score_details
with (security_invoker = true)
as
select
  sc.school_id, sc.id as score_id, sc.student_id, st.admission_number,
  st.full_name as student_name, sc.class_id, cl.name as class_name,
  cl.arm, sc.subject_id, su.name as subject_name, sc.term_id,
  sc.ca_score, sc.exam_score,
  (sc.ca_score + sc.exam_score) as total_score,
  gb.grade,
  sc.submitted_by, sc.updated_at
from public.scores sc
join public.students st on st.school_id = sc.school_id and st.id = sc.student_id
join public.classes cl on cl.school_id = sc.school_id and cl.id = sc.class_id
join public.subjects su on su.school_id = sc.school_id and su.id = sc.subject_id
left join lateral (
  select b.grade
  from public.grade_bands b
  where b.school_id = sc.school_id
    and b.grading_scale_id = sc.grading_scale_id
    and (sc.ca_score + sc.exam_score) >= b.min_score
    and ((sc.ca_score + sc.exam_score) < b.max_score
      or ((sc.ca_score + sc.exam_score) = b.max_score
          and b.max_score = (select gs.ca_max + gs.exam_max from public.grading_scales gs
            where gs.school_id=sc.school_id and gs.id=sc.grading_scale_id)))
  order by b.min_score desc
  limit 1
) gb on true;

-- Full broadsheet is returned only through this scoped RPC. Subject teachers
-- get their assigned subject details, not all other subjects' marks.
create or replace function public.get_class_broadsheet(
  p_class_id uuid, p_term_id uuid
)
returns table (
  student_id uuid,
  admission_number text,
  student_name text,
  subject_id uuid,
  subject_name text,
  ca_score numeric,
  exam_score numeric,
  subject_total numeric,
  subject_grade text,
  overall_total numeric,
  average_score numeric,
  class_position bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare v_school uuid := private.jwt_school_id();
begin
  if not (
    private.is_school_admin(v_school)
    or private.is_form_teacher(v_school,p_class_id)
  ) then
    raise exception 'Only the school administrator or assigned form teacher can view the complete broadsheet.';
  end if;

  return query
  with visible_scores as (
    select sc.student_id, st.admission_number, st.full_name,
           sc.subject_id, su.name as subj_name,
           sc.ca_score, sc.exam_score,
           (sc.ca_score+sc.exam_score)::numeric as total,
           gb.grade as grd
    from public.scores sc
    join public.students st on st.school_id=sc.school_id and st.id=sc.student_id
    join public.subjects su on su.school_id=sc.school_id and su.id=sc.subject_id
    left join lateral (
      select b.grade
      from public.grade_bands b
      where b.school_id=sc.school_id
        and b.grading_scale_id=sc.grading_scale_id
        and (sc.ca_score+sc.exam_score) >= b.min_score
        and ((sc.ca_score+sc.exam_score) < b.max_score
          or ((sc.ca_score+sc.exam_score) = b.max_score
              and b.max_score = (select gs.ca_max + gs.exam_max from public.grading_scales gs
                where gs.school_id=sc.school_id and gs.id=sc.grading_scale_id)))
      order by b.min_score desc
      limit 1
    ) gb on true
    where sc.school_id=v_school and sc.class_id=p_class_id and sc.term_id=p_term_id
  ),
  totals as (
    select vs.student_id, sum(vs.total)::numeric as overall,
           avg(vs.total)::numeric(7,2) as average
    from visible_scores vs group by vs.student_id
  ),
  ranked as (
    select t.student_id,t.overall,t.average,
           rank() over(order by t.average desc) as pos
    from totals t
  )
  select vs.student_id,vs.admission_number,vs.full_name,vs.subject_id,
         vs.subj_name,vs.ca_score,vs.exam_score,vs.total,vs.grd,
         r.overall,r.average,r.pos
  from visible_scores vs
  join ranked r on r.student_id=vs.student_id
  order by vs.full_name,vs.subj_name;
end;
$$;

drop function if exists public.verify_result_publication(text);
create or replace function public.verify_result_publication(p_code text)
returns table (
  school_name text, class_name text, class_arm text, term_name text,
  session_name text, version integer, published_at timestamptz,
  is_current boolean, snapshot_hash text, student_count integer,
  snapshot_integrity_valid boolean
)
language sql stable security definer
set search_path = ''
as $$
  select sch.name,cl.name,cl.arm,t.term_name,sess.name,
    rp.version,rp.published_at,rp.is_current,rp.snapshot_hash,
    coalesce((select count(distinct e.value->>'student_id')::integer
      from jsonb_array_elements(coalesce(rp.snapshot->'rows','[]'::jsonb)) as e(value)),0),
    (rp.snapshot_hash=encode(extensions.digest(convert_to(rp.snapshot::text,'UTF8'),'sha256'),'hex'))
  from public.result_publications rp
  join public.schools sch on sch.id=rp.school_id
  join public.classes cl on cl.school_id=rp.school_id and cl.id=rp.class_id
  join public.academic_terms t on t.school_id=rp.school_id and t.id=rp.term_id
  join public.academic_sessions sess on sess.school_id=t.school_id and sess.id=t.session_id
  where rp.verification_code=upper(trim(p_code))
  limit 1
$$;

-- Create a complete grading scale in one server transaction. p_bands must be
-- an array of {grade, remark, min_score, max_score} objects covering the full range.
create or replace function public.create_grading_scale(
  p_name text, p_ca_max numeric, p_exam_max numeric, p_bands jsonb, p_make_default boolean default false
)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_school uuid:=private.jwt_school_id(); v_id uuid;
begin
  if not private.is_school_admin(v_school) then raise exception 'Only the school administrator can configure grading scales.'; end if;
  if jsonb_typeof(p_bands)<>'array' or jsonb_array_length(p_bands)=0 then
    raise exception 'Provide grade bands as a non-empty JSON array.';
  end if;
  if p_ca_max<=0 or p_exam_max<=0 then raise exception 'Score maxima must be positive.'; end if;
  if p_make_default then
    update public.grading_scales set is_default=false where school_id=v_school and is_default;
  end if;
  insert into public.grading_scales(school_id,name,ca_max,exam_max,is_default)
  values(v_school,trim(p_name),p_ca_max,p_exam_max,false) returning id into v_id;
  insert into public.grade_bands(school_id,grading_scale_id,grade,remark,min_score,max_score)
  select v_school,v_id,x.grade,x.remark,x.min_score,x.max_score
  from jsonb_to_recordset(p_bands) as x(grade text,remark text,min_score numeric,max_score numeric);
  if p_make_default or not exists(select 1 from public.grading_scales where school_id=v_school and is_default) then
    update public.grading_scales set is_default=true where school_id=v_school and id=v_id;
  end if;
  return v_id;
end; $$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.schools enable row level security;
alter table public.profiles enable row level security;
alter table public.classes enable row level security;
alter table public.subjects enable row level security;
alter table public.academic_sessions enable row level security;
alter table public.academic_terms enable row level security;
alter table public.grading_scales enable row level security;
alter table public.grade_bands enable row level security;
alter table public.students enable row level security;
alter table public.teacher_assignments enable row level security;
alter table public.scores enable row level security;
alter table public.attendance enable row level security;
alter table public.student_comments enable row level security;
alter table public.principal_comments enable row level security;
alter table public.audit_events enable row level security;
alter table public.result_publications enable row level security;

-- School and staff configuration: administrators manage their own school.
create policy schools_read_own on public.schools for select to authenticated
using (id = private.jwt_school_id());
create policy schools_admin_update on public.schools for update to authenticated
using (private.is_school_admin(id)) with check (private.is_school_admin(id));

create policy profiles_read_school on public.profiles for select to authenticated
using (school_id = private.jwt_school_id());
create policy profiles_admin_manage on public.profiles for all to authenticated
using (private.is_school_admin(school_id))
with check (private.is_school_admin(school_id));

create policy classes_read_school on public.classes for select to authenticated
using (school_id = private.jwt_school_id());
create policy classes_admin_manage on public.classes for all to authenticated
using (private.is_school_admin(school_id))
with check (private.is_school_admin(school_id));

create policy subjects_read_school on public.subjects for select to authenticated
using (school_id = private.jwt_school_id());
create policy subjects_admin_manage on public.subjects for all to authenticated
using (private.is_school_admin(school_id))
with check (private.is_school_admin(school_id));

create policy sessions_read_school on public.academic_sessions for select to authenticated
using (school_id = private.jwt_school_id());
create policy sessions_admin_manage on public.academic_sessions for all to authenticated
using (private.is_school_admin(school_id))
with check (private.is_school_admin(school_id));

create policy terms_read_school on public.academic_terms for select to authenticated
using (school_id = private.jwt_school_id());
create policy terms_admin_manage on public.academic_terms for all to authenticated
using (private.is_school_admin(school_id))
with check (private.is_school_admin(school_id));

create policy scales_read_school on public.grading_scales for select to authenticated
using (school_id = private.jwt_school_id());
create policy scales_admin_manage on public.grading_scales for all to authenticated
using (private.is_school_admin(school_id))
with check (private.is_school_admin(school_id));

create policy grade_bands_read_school on public.grade_bands for select to authenticated
using (school_id = private.jwt_school_id());
create policy grade_bands_admin_manage on public.grade_bands for all to authenticated
using (private.is_school_admin(school_id))
with check (private.is_school_admin(school_id));

-- Student visibility: admins, assigned form teachers, and teachers assigned
-- to at least one subject in the exact class. A future student role sees self.
create policy students_read_scoped on public.students for select to authenticated
using (private.can_view_student(school_id,class_id,id));
create policy students_read_self on public.students for select to authenticated
using (
  school_id=private.jwt_school_id()
  and profile_id=auth.uid()
  and private.jwt_role()='student'
);
create policy students_admin_manage on public.students for all to authenticated
using (private.is_school_admin(school_id))
with check (private.is_school_admin(school_id));

create policy assignments_read_self_or_admin on public.teacher_assignments
for select to authenticated
using (school_id=private.jwt_school_id()
  and (teacher_id=auth.uid() or private.is_school_admin(school_id)));
create policy assignments_admin_manage on public.teacher_assignments
for all to authenticated
using (private.is_school_admin(school_id))
with check (private.is_school_admin(school_id));

-- Subject teachers can read only their assigned subject scores. Form teachers
-- do not receive direct score-table access; they use the full broadsheet RPC.
create policy scores_read_assigned_subject on public.scores for select to authenticated
using (
  school_id=private.jwt_school_id()
  and (
    private.is_school_admin(school_id)
    or private.teaches_subject(school_id,class_id,subject_id)
    or (
      private.jwt_role()='student'
      and exists (
        select 1 from public.students st
        where st.school_id=scores.school_id and st.id=scores.student_id
          and st.profile_id=auth.uid()
      )
    )
  )
);
-- No authenticated INSERT/UPDATE/DELETE policies on scores. All writes use RPC.

create policy attendance_read_scoped on public.attendance for select to authenticated
using (
  school_id=private.jwt_school_id()
  and (
    private.is_school_admin(school_id)
    or private.is_form_teacher(school_id,class_id)
    or (private.jwt_role()='student' and exists (
      select 1 from public.students st
      where st.school_id=attendance.school_id and st.id=attendance.student_id
        and st.profile_id=auth.uid()
    ))
  )
);
create policy attendance_form_teacher_insert on public.attendance
for insert to authenticated
with check (
  school_id=private.jwt_school_id()
  and marked_by=auth.uid()
  and private.is_form_teacher(school_id,class_id)
);
create policy attendance_form_teacher_update on public.attendance
for update to authenticated
using (school_id=private.jwt_school_id() and private.is_form_teacher(school_id,class_id))
with check (
  school_id=private.jwt_school_id()
  and private.is_form_teacher(school_id,class_id)
  and marked_by=auth.uid()
);
create policy attendance_form_teacher_delete on public.attendance
for delete to authenticated
using (school_id=private.jwt_school_id() and private.is_form_teacher(school_id,class_id));

create policy comments_read_scoped on public.student_comments for select to authenticated
using (
  school_id=private.jwt_school_id()
  and (private.is_school_admin(school_id)
       or private.is_form_teacher(school_id,class_id))
);
create policy comments_form_insert on public.student_comments for insert to authenticated
with check (
  school_id=private.jwt_school_id()
  and entered_by=auth.uid()
  and private.is_form_teacher(school_id,class_id)
);
create policy comments_form_update on public.student_comments for update to authenticated
using (school_id=private.jwt_school_id() and private.is_form_teacher(school_id,class_id))
with check (school_id=private.jwt_school_id() and private.is_form_teacher(school_id,class_id));
create policy comments_form_delete on public.student_comments for delete to authenticated
using (school_id=private.jwt_school_id() and private.is_form_teacher(school_id,class_id));

create policy principal_comments_read on public.principal_comments for select to authenticated
using (school_id=private.jwt_school_id()
  and (private.is_school_admin(school_id) or private.jwt_role()='teacher'));
create policy principal_comments_admin_manage on public.principal_comments
for all to authenticated
using (private.is_school_admin(school_id))
with check (private.is_school_admin(school_id));

create policy audit_admin_read on public.audit_events for select to authenticated
using (school_id=private.jwt_school_id() and private.is_school_admin(school_id));

create policy publications_read_school on public.result_publications for select to authenticated
using (school_id=private.jwt_school_id());

-- Final least-privilege policy overrides. Policies are additive, so remove
-- broader draft policies before installing the scoped versions.
drop policy if exists profiles_read_school on public.profiles;
drop policy if exists profiles_admin_manage on public.profiles;
create policy profiles_read_scoped on public.profiles for select to authenticated
using (id=auth.uid() or private.is_school_admin(school_id));
create policy profiles_admin_update on public.profiles for update to authenticated
using (private.is_school_admin(school_id)) with check (private.is_school_admin(school_id));

drop policy if exists classes_read_school on public.classes;
create policy classes_read_scoped on public.classes for select to authenticated
using (school_id=private.jwt_school_id() and (
  private.is_school_admin(school_id)
  or private.is_form_teacher(school_id,id)
  or exists (select 1 from public.teacher_assignments a
    where a.school_id=classes.school_id and a.class_id=classes.id and a.teacher_id=auth.uid()
      and exists (select 1 from public.profiles p where p.id=a.teacher_id and p.school_id=a.school_id and p.role='teacher' and p.is_active))
));

drop policy if exists subjects_read_school on public.subjects;
create policy subjects_read_scoped on public.subjects for select to authenticated
using (school_id=private.jwt_school_id() and (
  private.is_school_admin(school_id)
  or exists (select 1 from public.teacher_assignments a
    where a.school_id=subjects.school_id and a.subject_id=subjects.id and a.teacher_id=auth.uid()
      and exists (select 1 from public.profiles p where p.id=a.teacher_id and p.school_id=a.school_id and p.role='teacher' and p.is_active))
));

drop policy if exists principal_comments_read on public.principal_comments;
create policy principal_comments_read_scoped on public.principal_comments for select to authenticated
using (private.is_school_admin(school_id) or private.is_form_teacher(school_id,class_id));

drop policy if exists publications_read_school on public.result_publications;
create policy publications_read_scoped on public.result_publications for select to authenticated
using (private.is_school_admin(school_id) or private.is_form_teacher(school_id,class_id));

-- Grade bands must exactly cover [0, CA maximum + exam maximum], without
-- overlaps or gaps. Deferred checks permit one atomic multi-row setup RPC/SQL transaction.
create or replace function private.validate_grading_scale_complete()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_school uuid; v_scale uuid; v_total numeric; v_count integer; v_min numeric; v_max numeric; v_bad integer;
begin
  if tg_table_name='grading_scales' then
    v_school:=coalesce(new.school_id,old.school_id); v_scale:=coalesce(new.id,old.id);
  else
    v_school:=coalesce(new.school_id,old.school_id);
    v_scale:=coalesce(new.grading_scale_id,old.grading_scale_id);
  end if;
  select ca_max+exam_max into v_total from public.grading_scales
    where school_id=v_school and id=v_scale;
  if not found then return null; end if;
  select count(*),min(min_score),max(max_score) into v_count,v_min,v_max
    from public.grade_bands where school_id=v_school and grading_scale_id=v_scale;
  if v_count=0 then raise exception 'Every grading scale must have grade bands before commit.'; end if;
  if v_min<>0 or v_max<>v_total then
    raise exception 'Grade bands must start at zero and end at the grading scale maximum (%).',v_total;
  end if;
  select count(*) into v_bad from (
    select min_score,lag(max_score) over(order by min_score,max_score,grade) as previous_max
    from public.grade_bands where school_id=v_school and grading_scale_id=v_scale
  ) x where previous_max is not null and previous_max<>min_score;
  if v_bad>0 then raise exception 'Grade bands contain a gap or overlap.'; end if;
  return null;
end; $$;
create constraint trigger trg_grade_bands_complete
  after insert or update or delete on public.grade_bands
  deferrable initially deferred for each row execute function private.validate_grading_scale_complete();
create constraint trigger trg_grading_scale_complete
  after insert or update on public.grading_scales
  deferrable initially deferred for each row execute function private.validate_grading_scale_complete();

-- Prevent any grade-band mutation once the scale has been used by a score.
create or replace function private.reject_used_grade_band_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_school uuid; v_scale uuid;
begin
  if tg_op<>'INSERT' then
    if exists(select 1 from public.scores where school_id=old.school_id and grading_scale_id=old.grading_scale_id) then
      raise exception 'This grading scale has been used; its grade bands are locked.';
    end if;
  end if;
  if tg_op<>'DELETE' then
    if exists(select 1 from public.scores where school_id=new.school_id and grading_scale_id=new.grading_scale_id) then
      raise exception 'This grading scale has been used; its grade bands are locked.';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if; return new;
end; $$;
drop trigger if exists trg_lock_used_grade_bands on public.grade_bands;
create trigger trg_lock_used_grade_bands before insert or update or delete on public.grade_bands
for each row execute function private.reject_used_grade_band_mutation();


-- ---------------------------------------------------------------------------
-- Explicit grants: RLS is not a substitute for SQL privileges.
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant usage on schema public to authenticated;
grant select on
  public.schools, public.profiles, public.classes, public.subjects,
  public.academic_sessions, public.academic_terms, public.grading_scales,
  public.grade_bands, public.students, public.teacher_assignments,
  public.scores, public.attendance, public.student_comments,
  public.principal_comments, public.audit_events, public.result_publications
to authenticated;

-- Configuration tables: admin CRUD (RLS narrows to own school).
grant insert, update, delete on
  public.classes, public.subjects, public.academic_sessions,
  public.grading_scales, public.grade_bands,
  public.students, public.teacher_assignments
to authenticated;
-- Terms can be created/deleted by admins, but status transitions go through
-- set_term_status() so each transition is audited.
grant insert, delete on public.academic_terms to authenticated;

-- Attendance and form-teacher comments are the only direct teacher writes.
grant delete on public.attendance to authenticated;
grant insert (school_id,student_id,class_id,term_id,attendance_date,status,marked_by)
  on public.attendance to authenticated;
grant update (attendance_date,status,marked_by) on public.attendance to authenticated;

grant insert (school_id,student_id,class_id,term_id,form_teacher_comment,conduct,entered_by)
  on public.student_comments to authenticated;
grant update (form_teacher_comment,conduct) on public.student_comments to authenticated;
grant delete on public.student_comments to authenticated;

-- Principal comments are admin-managed. Score, audit and publication tables
-- have no direct client write grants.
grant update on public.schools to authenticated;
revoke insert, delete on public.profiles from authenticated;
revoke update on public.profiles from authenticated;
grant update (full_name,is_active) on public.profiles to authenticated;
grant insert, update, delete on public.principal_comments to authenticated;

-- RPC execution permissions.
revoke all on function public.create_grading_scale(text,numeric,numeric,jsonb,boolean) from public, anon;
grant execute on function public.create_grading_scale(text,numeric,numeric,jsonb,boolean) to authenticated;
revoke all on function public.save_subject_score(uuid,uuid,uuid,numeric,numeric,text) from public, anon;
grant execute on function public.save_subject_score(uuid,uuid,uuid,numeric,numeric,text) to authenticated;

revoke all on function public.set_term_status(uuid,text,text) from public, anon;
grant execute on function public.set_term_status(uuid,text,text) to authenticated;

revoke all on function public.publish_class_result(uuid,uuid,text) from public, anon;
grant execute on function public.publish_class_result(uuid,uuid,text) to authenticated;

revoke all on function public.get_class_broadsheet(uuid,uuid) from public, anon;
grant execute on function public.get_class_broadsheet(uuid,uuid) to authenticated;

revoke all on function public.verify_result_publication(text) from public;
grant execute on function public.verify_result_publication(text) to anon, authenticated;

grant select on public.subject_score_details to authenticated;

-- Private helper functions are not an API surface.
revoke all on all functions in schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.jwt_school_id() to authenticated;
grant execute on function private.jwt_role() to authenticated;
grant execute on function private.is_school_admin(uuid) to authenticated;
grant execute on function private.is_form_teacher(uuid,uuid) to authenticated;
grant execute on function private.teaches_subject(uuid,uuid,uuid) to authenticated;
grant execute on function private.can_view_student(uuid,uuid,uuid) to authenticated;


-- Audit attendance and teacher-entered comments as well as score changes.
create or replace function private.audit_class_record_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_row jsonb; v_old jsonb; v_school uuid; v_actor uuid; v_id uuid;
begin
  if tg_op='DELETE' then v_row:=to_jsonb(old); else v_row:=to_jsonb(new); end if;
  if tg_op='UPDATE' or tg_op='DELETE' then v_old:=to_jsonb(old); end if;
  v_school:=(v_row->>'school_id')::uuid;
  v_actor:=auth.uid();
  v_id:=(v_row->>'id')::uuid;
  insert into public.audit_events(school_id,actor_id,event_type,table_name,record_id,reason,old_data,new_data)
  values(v_school,v_actor,lower(tg_op)||'_'||tg_table_name,tg_table_name,v_id,
    'Class record change',v_old,case when tg_op='DELETE' then null else v_row end);
  if tg_op='DELETE' then return old; end if; return new;
end; $$;
create trigger trg_audit_attendance after insert or update or delete on public.attendance
for each row execute function private.audit_class_record_change();
create trigger trg_audit_student_comments after insert or update or delete on public.student_comments
for each row execute function private.audit_class_record_change();
create trigger trg_audit_principal_comments after insert or update or delete on public.principal_comments
for each row execute function private.audit_class_record_change();
create trigger trg_audit_teacher_assignments after insert or update or delete on public.teacher_assignments
for each row execute function private.audit_class_record_change();
create trigger trg_audit_profiles after update on public.profiles
for each row execute function private.audit_class_record_change();
create trigger trg_audit_classes after insert or update or delete on public.classes
for each row execute function private.audit_class_record_change();
create trigger trg_audit_subjects after insert or update or delete on public.subjects
for each row execute function private.audit_class_record_change();
create trigger trg_audit_grading_scales after insert or update or delete on public.grading_scales
for each row execute function private.audit_class_record_change();
create trigger trg_audit_grade_bands after insert or update or delete on public.grade_bands
for each row execute function private.audit_class_record_change();

-- Only the trusted server (service_role/Edge Function) may create Auth-linked
-- profiles. Admin clients may update display name and active status only.
revoke insert, delete on public.profiles from authenticated, anon;
revoke update on public.profiles from authenticated, anon;
grant update (full_name,is_active) on public.profiles to authenticated;

-- No public/anonymous access to internal authorization helpers.
revoke all on all functions in schema private from public, anon;

commit;
