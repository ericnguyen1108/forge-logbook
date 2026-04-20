# Supabase Setup

Create a free Supabase project, then add the project URL and anon key to a local `.env` file:

```bash
VITE_SUPABASE_URL=your-project-url
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Do not commit `.env`. The anon key is designed for frontend use, but your data is only safe when Row Level Security is enabled correctly. Never put a Supabase `service_role` key in this app.

In the Supabase SQL editor, run:

```sql
create table if not exists public.app_snapshots (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc'::text, now())
);

alter table public.app_snapshots enable row level security;

drop policy if exists "Users can read their own snapshot" on public.app_snapshots;
create policy "Users can read their own snapshot"
on public.app_snapshots
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert their own snapshot" on public.app_snapshots;
create policy "Users can insert their own snapshot"
on public.app_snapshots
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update their own snapshot" on public.app_snapshots;
create policy "Users can update their own snapshot"
on public.app_snapshots
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own snapshot" on public.app_snapshots;
create policy "Users can delete their own snapshot"
on public.app_snapshots
for delete
to authenticated
using (auth.uid() = user_id);
```

In Supabase Auth settings:

- Enable Email provider
- Enable Magic Link / OTP sign in
- Add your Vercel production URL as an allowed redirect URL
- Add `http://localhost:5173/**` for local development

Recommended redirect URLs:

```text
https://your-app.vercel.app/**
http://localhost:5173/**
```

Before going public, verify these checks:

- `public.app_snapshots` has Row Level Security enabled
- Policies use `auth.uid() = user_id`
- You can log in with one email and cannot read another user's row
- No `service_role` key exists in GitHub, Vercel frontend env vars, or browser code
