import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
let db: PGlite;
const org = "11111111-1111-4111-8111-111111111111";
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create table public.organizations(id uuid primary key);
    insert into organizations values ('${org}');`);
  const foundation = readFileSync("supabase/migrations/20260826175448_provider_neutral_sms_foundation.sql", "utf8");
  const oldPattern = foundation.match(/phone_e164 text not null check \(phone_e164 ~ ('[^']+')\)/)![1];
  await db.exec(`create table sms_organization_settings(phone_number_e164 text check (phone_number_e164 ~ ${oldPattern}));`);
  for (const table of ["sms_contact_consents", "sms_suppressions", "sms_audience_snapshot_recipients"]) {
    await db.exec(`create table ${table}(phone_e164 text check (phone_e164 ~ ${oldPattern}));`);
  }
  await db.exec(readFileSync("supabase/migrations/20260912192649_sms_individual_permission_events.sql", "utf8"));
}, 60000);
afterAll(async () => { await db?.close(); });
const insert = `insert into public.sms_permission_events(org_id,phone_e164,category,status,method,disclosure,obtained_at)
  values ('${org}','+12125551234','informational','granted','verbal','Agreed to church schedule updates and opt-out instructions.',now())`;
it("persists a normalized phone and immutable evidence through the service role", async () => {
  await db.exec("set role service_role");
  try { await db.exec(insert); expect((await db.query("select * from public.sms_permission_events")).rows).toHaveLength(1); }
  finally { await db.exec("reset role"); }
});
it("denies direct history reads and writes from both client roles", async () => {
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    try {
      await expect(db.exec("select * from public.sms_permission_events")).rejects.toThrow(/permission denied/);
      await expect(db.exec(insert)).rejects.toThrow(/permission denied/);
    } finally { await db.exec("reset role"); }
  }
});
it("prevents the service API from overwriting or deleting historical evidence", async () => {
  await db.exec("set role service_role");
  try {
    await expect(db.exec("update public.sms_permission_events set status='revoked'")).rejects.toThrow(/permission denied/);
    await expect(db.exec("delete from public.sms_permission_events")).rejects.toThrow(/permission denied/);
  } finally { await db.exec("reset role"); }
});
it("rejects verbal promotional grants at the database boundary", async () => {
  await expect(db.exec(insert.replace("'informational'", "'promotional'"))).rejects.toThrow(/check constraint/);
});
it("rejects future evidence dates and malformed numbers", async () => {
  await expect(db.exec(insert.replace("now()", "now() + interval '1 day'"))).rejects.toThrow(/check constraint/);
  await expect(db.exec(insert.replace("+12125551234", "2125551234"))).rejects.toThrow(/check constraint/);
});
it("has RLS enabled, no client policies, and indexes for actor and scoped history", async () => {
  expect((await db.query<{ relrowsecurity: boolean }>("select relrowsecurity from pg_class where oid='public.sms_permission_events'::regclass")).rows[0].relrowsecurity).toBe(true);
  expect((await db.query("select * from pg_policies where tablename='sms_permission_events'")).rows).toHaveLength(0);
  expect((await db.query("select * from pg_indexes where tablename='sms_permission_events'")).rows).toHaveLength(3);
});
it("accepts valid +1 phones in existing settings, consent, suppression, and snapshot tables", async () => {
  for (const table of ["sms_organization_settings", "sms_contact_consents", "sms_suppressions", "sms_audience_snapshot_recipients"]) {
    await db.exec(`insert into ${table} values ('+12125551234')`);
    await expect(db.exec(`insert into ${table} values ('2125551234')`)).rejects.toThrow(/check constraint/);
  }
});
