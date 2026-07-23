alter table public.contact_messages enable row level security;

drop policy if exists "contact_messages_no_client_access"
  on public.contact_messages;

create policy "contact_messages_no_client_access"
on public.contact_messages
for all
to anon, authenticated
using (false)
with check (false);

revoke all on table public.contact_messages from public, anon, authenticated;
grant insert on table public.contact_messages to service_role;
