-- Run this once in Supabase SQL Editor.
-- It is safe to run again: tables, functions, triggers, indexes, and policies are idempotent.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  full_name text not null,
  avatar_url text,
  role text not null default 'student' check (role in ('student', 'teacher')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists role text;
update public.profiles
set role = 'student'
where role is null or role not in ('student', 'teacher');
alter table public.profiles alter column role set default 'student';
alter table public.profiles alter column role set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_role_check'
  ) then
    alter table public.profiles
      add constraint profiles_role_check check (role in ('student', 'teacher'));
  end if;
end
$$;

create table if not exists public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  local_attempt_id text not null,
  completed_at timestamptz not null,
  difficulty text not null check (difficulty in ('easy', 'medium', 'hard')),
  question_count integer not null check (question_count > 0),
  percentage integer not null check (percentage between 0 and 100),
  duration_seconds integer not null check (duration_seconds >= 0),
  created_at timestamptz not null default now(),
  unique (user_id, local_attempt_id)
);

create index if not exists quiz_attempts_completed_at_idx
  on public.quiz_attempts (completed_at desc);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, username, role)
  values (
    new.id,
    trim(new.raw_user_meta_data ->> 'full_name'),
    lower(trim(new.raw_user_meta_data ->> 'username')),
    case
      when lower(trim(new.raw_user_meta_data ->> 'role')) = 'teacher' then 'teacher'
      else 'student'
    end
  );
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.quiz_attempts enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update on public.quiz_attempts to authenticated;

-- A signed-in user may edit their profile details, but never promote their own role.
revoke all on public.profiles, public.quiz_attempts from anon;
revoke delete, truncate, references, trigger on public.profiles, public.quiz_attempts from authenticated;
revoke update on public.profiles from authenticated;
grant update (username, full_name, avatar_url, updated_at) on public.profiles to authenticated;

drop policy if exists "Authenticated users can read profiles" on public.profiles;
create policy "Authenticated users can read profiles"
  on public.profiles for select to authenticated using (true);

drop policy if exists "Users can insert their own profile" on public.profiles;
create policy "Users can insert their own profile"
  on public.profiles for insert to authenticated
  with check ((select auth.uid()) = id);

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- These rows contain only leaderboard-safe aggregate metrics, never quiz content or answers.
drop policy if exists "Authenticated users can read quiz metrics" on public.quiz_attempts;
create policy "Authenticated users can read quiz metrics"
  on public.quiz_attempts for select to authenticated using (true);

drop policy if exists "Users can insert their own quiz metrics" on public.quiz_attempts;
create policy "Users can insert their own quiz metrics"
  on public.quiz_attempts for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own quiz metrics" on public.quiz_attempts;
create policy "Users can update their own quiz metrics"
  on public.quiz_attempts for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create table if not exists public.subjects (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 120),
  code text not null check (char_length(trim(code)) between 2 and 20),
  description text check (description is null or char_length(description) <= 500),
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  join_code text not null unique check (join_code ~ '^[A-Z0-9]+-[A-Z0-9]{5}$'),
  file_search_store_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.subject_memberships (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  unique (subject_id, student_id)
);

create table if not exists public.subject_sources (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects(id) on delete cascade,
  uploaded_by uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 240),
  mime_type text not null,
  gemini_file_search_document_name text,
  status text not null default 'processing' check (status in ('processing', 'ready', 'failed')),
  created_at timestamptz not null default now()
);

create table if not exists public.subject_questions (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  question text not null check (char_length(trim(question)) between 1 and 4000),
  status text not null default 'pending' check (status in ('pending', 'answered')),
  teacher_answer text,
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  check (
    (status = 'pending' and teacher_answer is null and answered_at is null)
    or
    (status = 'answered' and teacher_answer is not null and answered_at is not null)
  )
);

create index if not exists subjects_teacher_id_idx
  on public.subjects (teacher_id);
create index if not exists subject_memberships_student_id_idx
  on public.subject_memberships (student_id);
create index if not exists subject_sources_subject_id_idx
  on public.subject_sources (subject_id, created_at desc);
create index if not exists subject_sources_uploaded_by_idx
  on public.subject_sources (uploaded_by);
create index if not exists subject_questions_subject_status_idx
  on public.subject_questions (subject_id, status, created_at desc);
create index if not exists subject_questions_student_id_idx
  on public.subject_questions (student_id);
create unique index if not exists subject_questions_one_pending_question_idx
  on public.subject_questions (subject_id, student_id, md5(question))
  where status = 'pending';

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create or replace function private.is_teacher()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = 'teacher'
  );
$$;

create or replace function private.is_student()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = 'student'
  );
$$;

create or replace function private.owns_subject(requested_subject_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.subjects
    where id = requested_subject_id
      and teacher_id = (select auth.uid())
  );
$$;

create or replace function private.is_subject_member(requested_subject_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.subject_memberships
    where subject_id = requested_subject_id
      and student_id = (select auth.uid())
  );
$$;

revoke all on function private.is_teacher() from public;
revoke all on function private.is_student() from public;
revoke all on function private.owns_subject(uuid) from public;
revoke all on function private.is_subject_member(uuid) from public;
grant execute on function private.is_teacher() to authenticated;
grant execute on function private.is_student() to authenticated;
grant execute on function private.owns_subject(uuid) to authenticated;
grant execute on function private.is_subject_member(uuid) to authenticated;

create or replace function public.join_subject(requested_join_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  matched_subject_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'You must be logged in to join a subject.' using errcode = '28000';
  end if;

  if not private.is_student() then
    raise exception 'Only student accounts can join subjects.' using errcode = '42501';
  end if;

  select id
  into matched_subject_id
  from public.subjects
  where join_code = upper(trim(requested_join_code));

  if matched_subject_id is null then
    raise exception 'Subject code not found.' using errcode = 'P0002';
  end if;

  insert into public.subject_memberships (subject_id, student_id)
  values (matched_subject_id, (select auth.uid()))
  on conflict (subject_id, student_id) do nothing;

  return matched_subject_id;
end;
$$;

revoke all on function public.join_subject(text) from public, anon;
grant execute on function public.join_subject(text) to authenticated;

alter table public.subjects enable row level security;
alter table public.subject_memberships enable row level security;
alter table public.subject_sources enable row level security;
alter table public.subject_questions enable row level security;

revoke all on public.subjects, public.subject_memberships, public.subject_sources, public.subject_questions from anon, authenticated;
grant select, insert, update on public.subjects to authenticated;
grant select on public.subject_memberships to authenticated;
grant select, insert, update on public.subject_sources to authenticated;
grant select, insert on public.subject_questions to authenticated;

drop policy if exists "Teachers and members can read subjects" on public.subjects;
create policy "Teachers and members can read subjects"
  on public.subjects for select to authenticated
  using (
    teacher_id = (select auth.uid())
    or private.is_subject_member(id)
  );

drop policy if exists "Teachers can create subjects" on public.subjects;
create policy "Teachers can create subjects"
  on public.subjects for insert to authenticated
  with check (
    teacher_id = (select auth.uid())
    and private.is_teacher()
  );

drop policy if exists "Teachers can update own subjects" on public.subjects;
create policy "Teachers can update own subjects"
  on public.subjects for update to authenticated
  using (
    teacher_id = (select auth.uid())
    and private.is_teacher()
  )
  with check (
    teacher_id = (select auth.uid())
    and private.is_teacher()
  );

drop policy if exists "Students and subject teachers can read memberships" on public.subject_memberships;
create policy "Students and subject teachers can read memberships"
  on public.subject_memberships for select to authenticated
  using (
    student_id = (select auth.uid())
    or private.owns_subject(subject_id)
  );

drop policy if exists "Students can join subjects" on public.subject_memberships;
create policy "Students can join subjects"
  on public.subject_memberships for insert to authenticated
  with check (
    student_id = (select auth.uid())
    and private.is_student()
  );

drop policy if exists "Teachers and members can read subject sources" on public.subject_sources;
create policy "Teachers and members can read subject sources"
  on public.subject_sources for select to authenticated
  using (
    private.owns_subject(subject_id)
    or private.is_subject_member(subject_id)
  );

drop policy if exists "Teachers can create subject sources" on public.subject_sources;
create policy "Teachers can create subject sources"
  on public.subject_sources for insert to authenticated
  with check (
    uploaded_by = (select auth.uid())
    and private.owns_subject(subject_id)
    and private.is_teacher()
  );

drop policy if exists "Teachers can update subject sources" on public.subject_sources;
create policy "Teachers can update subject sources"
  on public.subject_sources for update to authenticated
  using (
    uploaded_by = (select auth.uid())
    and private.owns_subject(subject_id)
    and private.is_teacher()
  )
  with check (
    uploaded_by = (select auth.uid())
    and private.owns_subject(subject_id)
    and private.is_teacher()
  );

drop policy if exists "Students and subject teachers can read questions" on public.subject_questions;
create policy "Students and subject teachers can read questions"
  on public.subject_questions for select to authenticated
  using (
    student_id = (select auth.uid())
    or private.owns_subject(subject_id)
  );

drop policy if exists "Students can ask subject questions" on public.subject_questions;
create policy "Students can ask subject questions"
  on public.subject_questions for insert to authenticated
  with check (
    student_id = (select auth.uid())
    and private.is_student()
    and private.is_subject_member(subject_id)
    and status = 'pending'
    and teacher_answer is null
    and answered_at is null
  );
