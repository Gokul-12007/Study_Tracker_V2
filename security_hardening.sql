-- Study Tracker V2 – Supabase hardening. Run in SQL Editor. Idempotent (safe to re-run).
-- STEP 0 (run these two first and look at the output; don't skip):
--   select tablename, rowsecurity from pg_tables where schemaname = 'public';
--   select tablename, policyname, cmd, roles, qual, with_check from pg_policies where schemaname = 'public';
-- If any table shows rowsecurity = false, or has no policy, that table was readable/writable via your public key.

begin;

-- 1) Row Level Security: every row only visible/editable by its owner
alter table public.profiles       enable row level security;
alter table public.exams          enable row level security;
alter table public.subjects       enable row level security;
alter table public.chapters       enable row level security;
alter table public.study_sessions enable row level security;
alter table public.todos          enable row level security;
alter table public.user_settings  enable row level security;

-- Drop any old/loose policies on these tables so nothing permissive survives
do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies
           where schemaname = 'public'
             and tablename in ('profiles','exams','subjects','chapters','study_sessions','todos','user_settings')
  loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

create policy profiles_owner on public.profiles for all to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy user_settings_owner on public.user_settings for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy exams_owner on public.exams for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Child rows must also point at parents the same user owns (stops linking to someone else's ids)
create policy subjects_owner on public.subjects for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid())
    and exists (select 1 from public.exams e where e.id = exam_id and e.user_id = (select auth.uid())));

create policy chapters_owner on public.chapters for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid())
    and exists (select 1 from public.subjects s where s.id = subject_id and s.user_id = (select auth.uid())));

create policy study_sessions_owner on public.study_sessions for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid())
    and (exam_id    is null or exists (select 1 from public.exams    x where x.id = exam_id    and x.user_id = (select auth.uid())))
    and (subject_id is null or exists (select 1 from public.subjects x where x.id = subject_id and x.user_id = (select auth.uid())))
    and (chapter_id is null or exists (select 1 from public.chapters x where x.id = chapter_id and x.user_id = (select auth.uid()))));

create policy todos_owner on public.todos for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid())
    and (exam_id    is null or exists (select 1 from public.exams    x where x.id = exam_id    and x.user_id = (select auth.uid())))
    and (subject_id is null or exists (select 1 from public.subjects x where x.id = subject_id and x.user_id = (select auth.uid())))
    and (chapter_id is null or exists (select 1 from public.chapters x where x.id = chapter_id and x.user_id = (select auth.uid()))));

-- 2) Logged-out visitors get no table privileges at all (defence in depth)
revoke all on public.profiles, public.exams, public.subjects, public.chapters,
              public.study_sessions, public.todos, public.user_settings from anon;

-- 3) Foreign keys: deleting an exam/subject cleans up children; deleting a chapter keeps session history;
--    deleting an account removes its data.
alter table public.subjects drop constraint if exists subjects_exam_id_fkey,
  add constraint subjects_exam_id_fkey foreign key (exam_id) references public.exams(id) on delete cascade;
alter table public.chapters drop constraint if exists chapters_subject_id_fkey,
  add constraint chapters_subject_id_fkey foreign key (subject_id) references public.subjects(id) on delete cascade;

alter table public.study_sessions
  drop constraint if exists study_sessions_exam_id_fkey,
  drop constraint if exists study_sessions_subject_id_fkey,
  drop constraint if exists study_sessions_chapter_id_fkey,
  add constraint study_sessions_exam_id_fkey    foreign key (exam_id)    references public.exams(id)    on delete set null,
  add constraint study_sessions_subject_id_fkey foreign key (subject_id) references public.subjects(id) on delete set null,
  add constraint study_sessions_chapter_id_fkey foreign key (chapter_id) references public.chapters(id) on delete set null;

alter table public.todos
  drop constraint if exists todos_exam_id_fkey,
  drop constraint if exists todos_subject_id_fkey,
  drop constraint if exists todos_chapter_id_fkey,
  add constraint todos_exam_id_fkey    foreign key (exam_id)    references public.exams(id)    on delete set null,
  add constraint todos_subject_id_fkey foreign key (subject_id) references public.subjects(id) on delete set null,
  add constraint todos_chapter_id_fkey foreign key (chapter_id) references public.chapters(id) on delete set null;

alter table public.profiles       drop constraint if exists profiles_id_fkey,
  add constraint profiles_id_fkey foreign key (id) references auth.users(id) on delete cascade;
alter table public.exams          drop constraint if exists exams_user_id_fkey,
  add constraint exams_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
alter table public.subjects       drop constraint if exists subjects_user_id_fkey,
  add constraint subjects_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
alter table public.chapters       drop constraint if exists chapters_user_id_fkey,
  add constraint chapters_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
alter table public.study_sessions drop constraint if exists study_sessions_user_id_fkey,
  add constraint study_sessions_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
alter table public.todos          drop constraint if exists todos_user_id_fkey,
  add constraint todos_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
alter table public.user_settings  drop constraint if exists user_settings_user_id_fkey,
  add constraint user_settings_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;

-- 4) Data validation the client can't bypass
alter table public.exams    drop constraint if exists exams_color_hex,
  add constraint exams_color_hex check (color ~ '^#[0-9a-fA-F]{6}$');
alter table public.subjects drop constraint if exists subjects_color_hex,
  add constraint subjects_color_hex check (color is null or color ~ '^#[0-9a-fA-F]{6}$');

-- 5) updated_at actually updates
create or replace function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists trg_profiles_updated      on public.profiles;
drop trigger if exists trg_exams_updated         on public.exams;
drop trigger if exists trg_subjects_updated      on public.subjects;
drop trigger if exists trg_chapters_updated      on public.chapters;
drop trigger if exists trg_todos_updated         on public.todos;
drop trigger if exists trg_user_settings_updated on public.user_settings;
create trigger trg_profiles_updated      before update on public.profiles      for each row execute function public.set_updated_at();
create trigger trg_exams_updated         before update on public.exams         for each row execute function public.set_updated_at();
create trigger trg_subjects_updated      before update on public.subjects      for each row execute function public.set_updated_at();
create trigger trg_chapters_updated      before update on public.chapters      for each row execute function public.set_updated_at();
create trigger trg_todos_updated         before update on public.todos         for each row execute function public.set_updated_at();
create trigger trg_user_settings_updated before update on public.user_settings for each row execute function public.set_updated_at();

-- 6) Indexes so RLS filters and cascades stay fast
create index if not exists exams_user_idx          on public.exams (user_id);
create index if not exists subjects_user_idx       on public.subjects (user_id);
create index if not exists subjects_exam_idx       on public.subjects (exam_id);
create index if not exists chapters_user_idx       on public.chapters (user_id);
create index if not exists chapters_subject_idx    on public.chapters (subject_id);
create index if not exists sessions_user_time_idx  on public.study_sessions (user_id, started_at desc);
create index if not exists sessions_chapter_idx    on public.study_sessions (chapter_id);
create index if not exists todos_user_idx          on public.todos (user_id);

commit;

-- Also in Dashboard (can't be done in SQL):
--  Authentication → Providers → Email: keep "Confirm email" ON; raise minimum password length to 8+.
--  Authentication → URL Configuration: only your GitHub Pages URL as Site URL / Redirect URL (no wildcards).
--  Authentication → Attack Protection: enable CAPTCHA (Turnstile/hCaptcha) if sign-ups get spammed.
