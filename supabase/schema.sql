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

-- Updated Sprint 2: teacher-generated Official Quizzes.
-- Personal Practice Quiz history remains in public.quiz_attempts.
create table if not exists public.subject_quizzes (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 2 and 160),
  difficulty text not null check (difficulty in ('easy', 'medium', 'hard')),
  question_count integer not null check (question_count in (5, 10)),
  status text not null default 'draft' check (status in ('draft', 'published')),
  due_at timestamptz,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  check (
    (status = 'draft' and published_at is null)
    or (status = 'published' and published_at is not null)
  )
);

create table if not exists public.subject_quiz_questions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.subject_quizzes(id) on delete cascade,
  position integer not null check (position >= 0),
  question text not null check (char_length(trim(question)) between 1 and 600),
  options jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) = 4),
  topic text not null check (char_length(trim(topic)) between 1 and 120),
  created_at timestamptz not null default now(),
  unique (quiz_id, position)
);

-- Correct answers are deliberately separated from student-visible questions.
create table if not exists public.subject_quiz_answer_keys (
  question_id uuid primary key references public.subject_quiz_questions(id) on delete cascade,
  correct_index integer not null check (correct_index between 0 and 3),
  explanation text not null check (char_length(trim(explanation)) between 1 and 1200)
);

create table if not exists public.subject_quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.subject_quizzes(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  submitted_at timestamptz not null default now(),
  answers jsonb not null check (jsonb_typeof(answers) = 'array'),
  correct_count integer not null check (correct_count >= 0),
  incorrect_count integer not null check (incorrect_count >= 0),
  unanswered_count integer not null check (unanswered_count >= 0),
  percentage integer not null check (percentage between 0 and 100),
  duration_seconds integer not null check (duration_seconds between 0 and 86400),
  unique (quiz_id, student_id)
);

create index if not exists subject_quizzes_subject_status_idx
  on public.subject_quizzes (subject_id, status, created_at desc);
create index if not exists subject_quizzes_teacher_id_idx
  on public.subject_quizzes (teacher_id, created_at desc);
create index if not exists subject_quiz_questions_quiz_position_idx
  on public.subject_quiz_questions (quiz_id, position);
create index if not exists subject_quiz_attempts_student_id_idx
  on public.subject_quiz_attempts (student_id, submitted_at desc);

alter table public.subject_quizzes enable row level security;
alter table public.subject_quiz_questions enable row level security;
alter table public.subject_quiz_answer_keys enable row level security;
alter table public.subject_quiz_attempts enable row level security;

-- Explicit grants are required by Supabase projects that disable automatic Data API exposure.
revoke all on public.subject_quizzes, public.subject_quiz_questions,
  public.subject_quiz_answer_keys, public.subject_quiz_attempts from anon, authenticated;
grant select, insert, update, delete on public.subject_quizzes to authenticated;
grant select, insert on public.subject_quiz_questions to authenticated;
grant select, insert on public.subject_quiz_answer_keys to authenticated;
grant select on public.subject_quiz_attempts to authenticated;

drop policy if exists "Teachers and members can read subject quizzes" on public.subject_quizzes;
create policy "Teachers and members can read subject quizzes"
  on public.subject_quizzes for select to authenticated
  using (
    teacher_id = (select auth.uid())
    or (
      status = 'published'
      and private.is_subject_member(subject_id)
    )
  );

drop policy if exists "Teachers can create own subject quizzes" on public.subject_quizzes;
create policy "Teachers can create own subject quizzes"
  on public.subject_quizzes for insert to authenticated
  with check (
    teacher_id = (select auth.uid())
    and private.is_teacher()
    and private.owns_subject(subject_id)
    and status = 'draft'
    and published_at is null
  );

drop policy if exists "Teachers can publish own subject quizzes" on public.subject_quizzes;
create policy "Teachers can publish own subject quizzes"
  on public.subject_quizzes for update to authenticated
  using (
    teacher_id = (select auth.uid())
    and private.is_teacher()
    and private.owns_subject(subject_id)
  )
  with check (
    teacher_id = (select auth.uid())
    and private.is_teacher()
    and private.owns_subject(subject_id)
  );

drop policy if exists "Teachers can delete own draft quizzes" on public.subject_quizzes;
create policy "Teachers can delete own draft quizzes"
  on public.subject_quizzes for delete to authenticated
  using (
    teacher_id = (select auth.uid())
    and private.is_teacher()
    and private.owns_subject(subject_id)
    and status = 'draft'
  );

drop policy if exists "Teachers and members can read quiz questions" on public.subject_quiz_questions;
create policy "Teachers and members can read quiz questions"
  on public.subject_quiz_questions for select to authenticated
  using (
    exists (
      select 1
      from public.subject_quizzes quiz
      where quiz.id = quiz_id
        and (
          quiz.teacher_id = (select auth.uid())
          or (quiz.status = 'published' and private.is_subject_member(quiz.subject_id))
        )
    )
  );

drop policy if exists "Teachers can create quiz questions" on public.subject_quiz_questions;
create policy "Teachers can create quiz questions"
  on public.subject_quiz_questions for insert to authenticated
  with check (
    private.is_teacher()
    and exists (
      select 1
      from public.subject_quizzes quiz
      where quiz.id = quiz_id
        and quiz.teacher_id = (select auth.uid())
        and quiz.status = 'draft'
        and private.owns_subject(quiz.subject_id)
    )
  );

-- Only the owning teacher can query answer keys through the Data API.
drop policy if exists "Teachers can read own quiz answer keys" on public.subject_quiz_answer_keys;
create policy "Teachers can read own quiz answer keys"
  on public.subject_quiz_answer_keys for select to authenticated
  using (
    private.is_teacher()
    and exists (
      select 1
      from public.subject_quiz_questions question
      join public.subject_quizzes quiz on quiz.id = question.quiz_id
      where question.id = question_id
        and quiz.teacher_id = (select auth.uid())
        and private.owns_subject(quiz.subject_id)
    )
  );

drop policy if exists "Teachers can create own quiz answer keys" on public.subject_quiz_answer_keys;
create policy "Teachers can create own quiz answer keys"
  on public.subject_quiz_answer_keys for insert to authenticated
  with check (
    private.is_teacher()
    and exists (
      select 1
      from public.subject_quiz_questions question
      join public.subject_quizzes quiz on quiz.id = question.quiz_id
      where question.id = question_id
        and quiz.teacher_id = (select auth.uid())
        and quiz.status = 'draft'
        and private.owns_subject(quiz.subject_id)
    )
  );

drop policy if exists "Students and teachers can read official attempts" on public.subject_quiz_attempts;
create policy "Students and teachers can read official attempts"
  on public.subject_quiz_attempts for select to authenticated
  using (
    student_id = (select auth.uid())
    or exists (
      select 1
      from public.subject_quizzes quiz
      where quiz.id = quiz_id
        and quiz.teacher_id = (select auth.uid())
        and private.owns_subject(quiz.subject_id)
    )
  );

create or replace function public.get_subject_quiz_result(requested_quiz_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'You must be logged in to view a quiz result.' using errcode = '28000';
  end if;

  select jsonb_build_object(
    'id', attempt.id,
    'quizId', quiz.id,
    'title', quiz.title,
    'subjectName', subject.name,
    'difficulty', quiz.difficulty,
    'questionCount', quiz.question_count,
    'submittedAt', attempt.submitted_at,
    'correctCount', attempt.correct_count,
    'incorrectCount', attempt.incorrect_count,
    'unansweredCount', attempt.unanswered_count,
    'percentage', attempt.percentage,
    'durationSeconds', attempt.duration_seconds,
    'questions', (
      select jsonb_agg(
        jsonb_build_object(
          'id', question.id,
          'position', question.position,
          'question', question.question,
          'options', question.options,
          'topic', question.topic,
          'selectedIndex', attempt.answers -> question.position,
          'correctIndex', answer_key.correct_index,
          'explanation', answer_key.explanation
        ) order by question.position
      )
      from public.subject_quiz_questions question
      join public.subject_quiz_answer_keys answer_key on answer_key.question_id = question.id
      where question.quiz_id = quiz.id
    )
  )
  into result
  from public.subject_quiz_attempts attempt
  join public.subject_quizzes quiz on quiz.id = attempt.quiz_id
  join public.subjects subject on subject.id = quiz.subject_id
  where attempt.quiz_id = requested_quiz_id
    and attempt.student_id = (select auth.uid());

  if result is null then
    raise exception 'Quiz result not found.' using errcode = 'P0002';
  end if;
  return result;
end;
$$;

create or replace function public.submit_subject_quiz(
  requested_quiz_id uuid,
  submitted_answers jsonb,
  requested_duration_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  quiz_record record;
  answer_index integer;
  answer_value jsonb;
  actual_question_count integer;
  calculated_correct integer;
  calculated_unanswered integer;
  calculated_incorrect integer;
  calculated_percentage integer;
begin
  if (select auth.uid()) is null then
    raise exception 'You must be logged in to submit a quiz.' using errcode = '28000';
  end if;
  if not private.is_student() then
    raise exception 'Only student accounts can submit official quizzes.' using errcode = '42501';
  end if;

  select id, subject_id, question_count, due_at
  into quiz_record
  from public.subject_quizzes
  where id = requested_quiz_id
    and status = 'published';

  if quiz_record is null or not private.is_subject_member(quiz_record.subject_id) then
    raise exception 'Published quiz not found.' using errcode = 'P0002';
  end if;
  if quiz_record.due_at is not null and quiz_record.due_at <= now() then
    raise exception 'This quiz deadline has passed.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.subject_quiz_attempts
    where quiz_id = requested_quiz_id and student_id = (select auth.uid())
  ) then
    raise exception 'You have already submitted this quiz.' using errcode = '23505';
  end if;
  if requested_duration_seconds is null or requested_duration_seconds < 0 or requested_duration_seconds > 86400 then
    raise exception 'Quiz duration is invalid.' using errcode = '22023';
  end if;
  if jsonb_typeof(submitted_answers) <> 'array'
    or jsonb_array_length(submitted_answers) <> quiz_record.question_count then
    raise exception 'Submit exactly one answer slot per question.' using errcode = '22023';
  end if;

  for answer_index in 0..quiz_record.question_count - 1 loop
    answer_value := submitted_answers -> answer_index;
    if jsonb_typeof(answer_value) = 'null' then
      continue;
    end if;
    if jsonb_typeof(answer_value) <> 'number'
      or (answer_value #>> '{}') !~ '^[0-3]$' then
      raise exception 'Each answer must be null or an option index from 0 to 3.' using errcode = '22023';
    end if;
  end loop;

  select count(*)
  into actual_question_count
  from public.subject_quiz_questions question
  join public.subject_quiz_answer_keys answer_key on answer_key.question_id = question.id
  where question.quiz_id = requested_quiz_id;
  if actual_question_count <> quiz_record.question_count then
    raise exception 'This quiz is incomplete and cannot be submitted.' using errcode = '55000';
  end if;

  select
    count(*) filter (
      where (submitted_answers ->> question.position)::integer = answer_key.correct_index
    ),
    count(*) filter (
      where jsonb_typeof(submitted_answers -> question.position) = 'null'
    )
  into calculated_correct, calculated_unanswered
  from public.subject_quiz_questions question
  join public.subject_quiz_answer_keys answer_key on answer_key.question_id = question.id
  where question.quiz_id = requested_quiz_id;

  calculated_incorrect := quiz_record.question_count - calculated_correct - calculated_unanswered;
  calculated_percentage := round((calculated_correct * 100.0) / quiz_record.question_count)::integer;

  insert into public.subject_quiz_attempts (
    quiz_id, student_id, answers, correct_count, incorrect_count,
    unanswered_count, percentage, duration_seconds
  ) values (
    requested_quiz_id, (select auth.uid()), submitted_answers, calculated_correct,
    calculated_incorrect, calculated_unanswered, calculated_percentage, requested_duration_seconds
  );

  return public.get_subject_quiz_result(requested_quiz_id);
exception
  when unique_violation then
    raise exception 'You have already submitted this quiz.' using errcode = '23505';
end;
$$;

revoke all on function public.get_subject_quiz_result(uuid) from public, anon;
revoke all on function public.submit_subject_quiz(uuid, jsonb, integer) from public, anon;
grant execute on function public.get_subject_quiz_result(uuid) to authenticated;
grant execute on function public.submit_subject_quiz(uuid, jsonb, integer) to authenticated;

-- Final Feature Sprint 3: college notices and study consistency.
create table if not exists public.college_notice_settings (
  id smallint primary key default 1 check (id = 1),
  file_search_store_name text not null unique,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.college_notice_sources (
  id uuid primary key default gen_random_uuid(),
  uploaded_by uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 240),
  mime_type text not null,
  gemini_file_search_document_name text,
  status text not null default 'processing' check (status in ('processing', 'ready', 'failed')),
  created_at timestamptz not null default now()
);

create table if not exists public.study_activity_daily (
  user_id uuid not null references public.profiles(id) on delete cascade,
  activity_date date not null default current_date,
  session_count smallint not null default 1 check (session_count between 0 and 2),
  updated_at timestamptz not null default now(),
  primary key (user_id, activity_date)
);

create index if not exists college_notice_sources_status_created_idx
  on public.college_notice_sources (status, created_at desc);
create index if not exists study_activity_daily_date_user_idx
  on public.study_activity_daily (activity_date desc, user_id);

alter table public.college_notice_settings enable row level security;
alter table public.college_notice_sources enable row level security;
alter table public.study_activity_daily enable row level security;

revoke all on public.college_notice_settings, public.college_notice_sources,
  public.study_activity_daily from anon, authenticated;
grant select, insert, update on public.college_notice_settings to authenticated;
grant select, insert, update on public.college_notice_sources to authenticated;
grant select on public.study_activity_daily to authenticated;

drop policy if exists "Authenticated profiles can read notice settings" on public.college_notice_settings;
create policy "Authenticated profiles can read notice settings"
  on public.college_notice_settings for select to authenticated
  using (private.is_teacher() or private.is_student());

drop policy if exists "Teachers can create notice settings" on public.college_notice_settings;
create policy "Teachers can create notice settings"
  on public.college_notice_settings for insert to authenticated
  with check (
    private.is_teacher()
    and created_by = (select auth.uid())
    and id = 1
  );

drop policy if exists "Teachers can update notice settings" on public.college_notice_settings;
create policy "Teachers can update notice settings"
  on public.college_notice_settings for update to authenticated
  using (private.is_teacher())
  with check (private.is_teacher() and id = 1);

drop policy if exists "Authenticated profiles can read notice sources" on public.college_notice_sources;
create policy "Authenticated profiles can read notice sources"
  on public.college_notice_sources for select to authenticated
  using (private.is_teacher() or private.is_student());

drop policy if exists "Teachers can register notice sources" on public.college_notice_sources;
create policy "Teachers can register notice sources"
  on public.college_notice_sources for insert to authenticated
  with check (private.is_teacher() and uploaded_by = (select auth.uid()));

drop policy if exists "Teachers can update notice sources" on public.college_notice_sources;
create policy "Teachers can update notice sources"
  on public.college_notice_sources for update to authenticated
  using (private.is_teacher() and uploaded_by = (select auth.uid()))
  with check (private.is_teacher() and uploaded_by = (select auth.uid()));

-- Activity rows expose only a date and capped session count. Students may read
-- the global set for the leaderboard, but nobody can write the table directly.
drop policy if exists "Students can read leaderboard activity" on public.study_activity_daily;
create policy "Students can read leaderboard activity"
  on public.study_activity_daily for select to authenticated
  using (private.is_student());

create or replace function public.record_study_activity()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  credited_count integer;
begin
  if (select auth.uid()) is null then
    raise exception 'You must be logged in to record study activity.' using errcode = '28000';
  end if;
  if not private.is_student() then
    raise exception 'Only student accounts can record study activity.' using errcode = '42501';
  end if;

  insert into public.study_activity_daily (user_id, activity_date, session_count, updated_at)
  values ((select auth.uid()), current_date, 1, now())
  on conflict (user_id, activity_date) do update
  set session_count = least(public.study_activity_daily.session_count + 1, 2),
      updated_at = now()
  returning session_count into credited_count;

  return credited_count;
end;
$$;

create or replace function public.get_study_leaderboard()
returns table (
  user_id uuid,
  username text,
  full_name text,
  active_days integer,
  current_streak integer,
  total_sessions_last_7 integer,
  learning_score integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'You must be logged in to view the leaderboard.' using errcode = '28000';
  end if;
  if not private.is_student() then
    raise exception 'Only student accounts can view the leaderboard.' using errcode = '42501';
  end if;

  return query
  with student_stats as (
    select
      profile.id as user_id,
      profile.username,
      profile.full_name,
      count(activity.activity_date) filter (
        where activity.activity_date between current_date - 6 and current_date
          and activity.session_count > 0
      )::integer as active_days,
      coalesce(sum(activity.session_count) filter (
        where activity.activity_date between current_date - 6 and current_date
      ), 0)::integer as total_sessions_last_7,
      case
        when exists (
          select 1 from public.study_activity_daily today
          where today.user_id = profile.id
            and today.activity_date = current_date
            and today.session_count > 0
        ) then current_date
        when exists (
          select 1 from public.study_activity_daily yesterday
          where yesterday.user_id = profile.id
            and yesterday.activity_date = current_date - 1
            and yesterday.session_count > 0
        ) then current_date - 1
        else null
      end as streak_anchor
    from public.profiles profile
    left join public.study_activity_daily activity on activity.user_id = profile.id
    where profile.role = 'student'
    group by profile.id, profile.username, profile.full_name
  ), streak_stats as (
    select
      stats.*,
      coalesce((
        select count(*)::integer
        from (
          select
            activity.activity_date,
            row_number() over (order by activity.activity_date desc)::integer - 1 as expected_offset
          from public.study_activity_daily activity
          where activity.user_id = stats.user_id
            and activity.session_count > 0
            and activity.activity_date <= stats.streak_anchor
        ) ordered_activity
        where stats.streak_anchor - ordered_activity.activity_date = ordered_activity.expected_offset
      ), 0)::integer as current_streak
    from student_stats stats
  ), scored as (
    select
      stats.user_id,
      stats.username,
      stats.full_name,
      stats.active_days,
      stats.current_streak,
      stats.total_sessions_last_7,
      least(100, round(
        (stats.active_days / 7.0) * 50
        + (least(stats.current_streak, 7) / 7.0) * 30
        + (least(stats.total_sessions_last_7, 14) / 14.0) * 20
      )::integer) as learning_score
    from streak_stats stats
  )
  select scored.user_id, scored.username, scored.full_name, scored.active_days,
    scored.current_streak, scored.total_sessions_last_7, scored.learning_score
  from scored
  order by scored.learning_score desc, scored.current_streak desc,
    scored.active_days desc, scored.username asc, scored.full_name asc;
end;
$$;

revoke all on function public.record_study_activity() from public, anon;
revoke all on function public.get_study_leaderboard() from public, anon;
grant execute on function public.record_study_activity() to authenticated;
grant execute on function public.get_study_leaderboard() to authenticated;
