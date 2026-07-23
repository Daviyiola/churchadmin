drop policy if exists "contact_messages_no_client_access"
  on public.contact_messages;

-- Keep the table protected if this explicit policy is rolled back.
alter table public.contact_messages enable row level security;
revoke all on table public.contact_messages from public, anon, authenticated;
grant insert on table public.contact_messages to service_role;
