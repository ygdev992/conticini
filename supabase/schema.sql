-- Da eseguire una volta nello SQL Editor di Supabase.
-- Una sola riga per la coppia: i dati dell'app stanno nel JSON, l'accesso è limitato alle e-mail elencate.
create table if not exists public.household (
  id uuid primary key default gen_random_uuid(),
  allowed_emails text[] not null,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.household enable row level security;

grant select, insert, update on public.household to authenticated;

create policy "membri leggono" on public.household for select to authenticated
  using ((auth.jwt() ->> 'email') = any (allowed_emails));

create policy "membri creano" on public.household for insert to authenticated
  with check ((auth.jwt() ->> 'email') = any (allowed_emails));

create policy "membri aggiornano" on public.household for update to authenticated
  using ((auth.jwt() ->> 'email') = any (allowed_emails))
  with check ((auth.jwt() ->> 'email') = any (allowed_emails));
