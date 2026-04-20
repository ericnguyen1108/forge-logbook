Create a free Supabase project, then add the project URL and anon key to a local `.env` file:

```bash
VITE_SUPABASE_URL=your-project-url
VITE_SUPABASE_ANON_KEY=your-anon-key
```

In the Supabase SQL editor, run:

```sql
create table if not exists public.app_snapshots (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc'::text, now())
);

alter table public.app_snapshots enable row level security;

create policy "Users can read their own snapshot"
on public.app_snapshots
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can insert their own snapshot"
on public.app_snapshots
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update their own snapshot"
on public.app_snapshots
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
```

In Supabase Auth settings:

- Enable Email provider
- Enable Magic Link / OTP sign in
- Add your Vercel production URL as an allowed redirect URL
