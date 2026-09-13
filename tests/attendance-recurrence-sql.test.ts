import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";

const org = "11111111-1111-4111-8111-111111111111", other = "99999999-9999-4999-8999-999999999999";
const actor = "22222222-2222-4222-8222-222222222222", service = "33333333-3333-4333-8333-333333333333";
const code = "44444444-4444-4444-8444-444444444444", second = "55555555-5555-4555-8555-555555555555";
const rule = { service_category_id: service, starts_on: "2030-01-01", ends_on: null, weekdays: [0], every_weeks: 1, service_time: "10:00", opens_before_minutes: 30, closes_after_minutes: 90 };
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; grant usage on schema auth to authenticated;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.organizations(id uuid primary key);
    create table public.user_organizations(organization_id uuid,user_id uuid,role text);
    create function public.is_org_data_entry(org uuid) returns boolean language sql security definer set search_path='' as $$
      select exists(select 1 from public.user_organizations where organization_id=org and user_id=auth.uid() and role in ('owner','admin','finance','member'))$$;
    create table public.categories(id uuid primary key,org_id uuid,name text,type text,status text,unique(id,org_id));
    create table public.organization_settings(organization_id uuid primary key,timezone_name text,timezone_confirmed boolean);
    create table public.attendance_sessions(id uuid primary key default gen_random_uuid(),org_id uuid not null,service_category_id uuid not null,session_date date not null default current_date,status text not null default 'draft' check(status in ('draft','published')),deleted_at timestamptz,created_by uuid not null default auth.uid(),unique(id,org_id));
    create schema cron; create table cron.jobs(name text primary key,schedule text,command text);
    create function cron.schedule(name text,schedule text,command text) returns bigint language sql as $$insert into cron.jobs values(name,schedule,command);select 1::bigint$$;
  `);
  const original = readFileSync("supabase/migrations/20260904160000_multiple_qr_attendance_checkin.sql", "utf8");
  await db.exec(original.slice(original.indexOf("create table public.attendance_checkin_codes"), original.indexOf("create table public.attendance_remembered_devices")));
  await db.exec(original.slice(original.indexOf("create or replace function public.close_checkin_windows_on_session_change"), original.indexOf("create or replace function public.redact_terminal_attendance_checkins")));
  await db.exec(original.slice(original.indexOf("create or replace function public.open_attendance_checkin_window"), original.indexOf("create or replace function public.resolve_attendance_public_checkin")));
  await db.exec(readFileSync("supabase/migrations/20260906115151_attendance_recurring_qr.sql", "utf8"));
}, 60000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec(`begin;
    insert into auth.users values('${actor}'); insert into organizations values('${org}'),('${other}');
    insert into user_organizations values('${org}','${actor}','owner');
    insert into categories values('${service}','${org}','Sunday service','services','active');
    insert into organization_settings values('${org}','UTC',true);
    insert into attendance_checkin_codes(id,org_id,name,created_by,updated_by) values('${code}','${org}','Lobby','${actor}','${actor}'),('${second}','${org}','Side entrance','${actor}','${actor}');
    select set_config('request.jwt.claim.sub','${actor}',true);
  `);
});
afterEach(async () => { await db.exec("rollback"); });
async function save(id = code, patch = {}) { await db.query("select public.save_attendance_checkin_schedule($1,$2)", [id, JSON.stringify({ ...rule, ...patch })]); }
async function prepare(id = code, time = "2030-01-06T09:20:00Z") { await db.query("select attendance_automation.prepare_code($1,$2)", [id, time]); }
async function rows(table: string) { return (await db.query<Record<string, any>>(`select * from ${table}`)).rows; }
async function attempt(sql: string, args: unknown[] = []) {
  await db.exec("savepoint attempt");
  try { await db.query(sql, args); } catch (error) { await db.exec("rollback to savepoint attempt"); throw error; }
  finally { await db.exec("release savepoint attempt"); }
}
it("installs the automatic minute scheduler", async () => {
  expect(await rows("cron.jobs")).toEqual([{ name: "attendance-recurring-checkin", schedule: "* * * * *", command: "select attendance_automation.run_schedules();" }]);
});
it("previews recurrence without creating distant future drafts", async () => {
  await save(); await prepare(code, "2030-01-06T09:14:00Z"); expect(await rows("attendance_sessions")).toHaveLength(0);
});
it("creates exactly one draft and window on repeated preparation", async () => {
  await save(); await prepare(); await prepare();
  const sessions = await rows("attendance_sessions"), windows = await rows("attendance_checkin_windows");
  expect(sessions).toHaveLength(1); expect(windows).toHaveLength(1);
  expect(sessions[0]).toMatchObject({ status: "draft", session_date: new Date("2030-01-06T00:00:00Z"), checkin_service_time: "10:00:00" });
  expect(windows[0].session_id).toBe(sessions[0].id);
});
it("shares the same draft across entrance codes for the same occurrence", async () => {
  await save(); await save(second); await prepare(); await prepare(second);
  expect(await rows("attendance_sessions")).toHaveLength(1); expect(await rows("attendance_checkin_windows")).toHaveLength(2);
});
it("reuses an existing unassigned draft", async () => {
  await db.exec(`insert into attendance_sessions(org_id,service_category_id,session_date,status) values('${org}','${service}','2030-01-06','draft')`);
  const id = (await rows("attendance_sessions"))[0].id;
  await save(); await prepare(); expect(await rows("attendance_sessions")).toHaveLength(1);
  expect((await rows("attendance_checkin_windows"))[0].session_id).toBe(id);
});
it.each(["ambiguous", "published"])("does not create a replacement for %s attendance", async reason => {
  await db.exec(`insert into attendance_sessions(org_id,service_category_id,session_date,status) values('${org}','${service}','2030-01-06','${reason === "published" ? "published" : "draft"}')`);
  if (reason === "ambiguous") await db.exec(`insert into attendance_sessions(org_id,service_category_id,session_date,status) values('${org}','${service}','2030-01-06','draft')`);
  await save(); await prepare(); expect(await rows("attendance_checkin_windows")).toHaveLength(0);
  expect((await rows("attendance_checkin_schedules"))[0].last_error).toMatch(reason === "published" ? /already published/ : /Multiple attendance drafts/);
});
it("does not guess which time slot owns a manually created draft", async () => {
  await save(); await save(second, { service_time: "11:00" });
  await db.exec(`insert into attendance_sessions(org_id,service_category_id,session_date,status) values('${org}','${service}','2030-01-06','draft')`);
  await prepare(); expect(await rows("attendance_checkin_windows")).toHaveLength(0);
  expect((await rows("attendance_checkin_schedules")).find(row => row.code_id === code)!.last_error).toMatch(/More than one service time/);
});
it("keeps separate drafts for distinct service times", async () => {
  await save(); await save(second, { service_time: "11:00" }); await prepare(); await prepare(second, "2030-01-06T10:20:00Z");
  expect(await rows("attendance_sessions")).toHaveLength(2);
});
it("honors the ten-draft cap and recovers after a slot is freed", async () => {
  await db.exec(`insert into attendance_sessions(org_id,service_category_id,session_date,status) select '${org}','${service}','2029-12-01'::date+i,'draft' from generate_series(0,9) i`);
  await save(); await prepare(); expect(await rows("attendance_sessions")).toHaveLength(10);
  expect((await rows("attendance_checkin_schedules"))[0].last_error).toMatch(/Max 10/);
  await db.exec("delete from attendance_sessions where id=(select id from attendance_sessions limit 1)");
  await prepare(); expect(await rows("attendance_checkin_windows")).toHaveLength(1);
});
it("never reopens a manually closed occurrence", async () => {
  await save(); await prepare(); await db.exec("update attendance_checkin_windows set status='closed'"); await prepare();
  expect((await rows("attendance_checkin_windows"))[0].status).toBe("closed");
});
it("publishing closes the occurrence and preparing again leaves it closed", async () => {
  await save(); await prepare(); await db.exec("update attendance_sessions set status='published'"); await prepare();
  expect((await rows("attendance_checkin_windows"))[0].status).toBe("closed"); expect(await rows("attendance_sessions")).toHaveLength(1);
});
it("skips an occurrence without creating its draft", async () => {
  await save(); await db.query("select public.act_attendance_checkin_schedule($1,'skip','2030-01-06')", [code]); await prepare();
  expect(await rows("attendance_sessions")).toHaveLength(0);
});
it("pause and resume do not reopen an occurrence that staff closed", async () => {
  await save(); await prepare(); await db.query("select public.act_attendance_checkin_schedule($1,'pause')", [code]);
  await db.query("select public.act_attendance_checkin_schedule($1,'resume')", [code]); await prepare();
  expect((await rows("attendance_checkin_windows"))[0].status).toBe("closed");
});
it("expires the old window and creates next week's occurrence", async () => {
  await save(); await prepare(); await prepare(code, "2030-01-13T09:20:00Z");
  expect(await rows("attendance_sessions")).toHaveLength(2);
  expect((await rows("attendance_checkin_windows")).map(row => row.status).sort()).toEqual(["closed", "scheduled"]);
});
it.each(["paused", "revoked", "expired", "timezone"])("does not create a draft for a %s schedule", async reason => {
  await save();
  if (reason === "paused") await db.exec("update attendance_checkin_schedules set paused=true");
  if (reason === "revoked") await db.exec("update attendance_checkin_codes set status='revoked'");
  if (reason === "expired") await db.exec("update attendance_checkin_codes set expires_on='2030-01-05'");
  if (reason === "timezone") await db.exec("update organization_settings set timezone_name='America/New_York'");
  await prepare(); expect(await rows("attendance_sessions")).toHaveLength(0);
});
it("does not grant authenticated callers access to the private scheduler", async () => {
  await db.exec("set local role authenticated");
  await expect(attempt("select attendance_automation.run_schedules()")).rejects.toThrow(/permission denied/);
  await expect(attempt("select attendance_automation.prepare_code($1)", [code])).rejects.toThrow(/permission denied/);
});
it("allows authenticated staff to save only their tenant's schedule", async () => {
  await db.exec("set local role authenticated"); await save();
  await db.exec("reset role"); await db.exec(`update user_organizations set organization_id='${other}'`);
  await db.exec("set local role authenticated");
  await expect(attempt("select public.save_attendance_checkin_schedule($1,$2)", [code, JSON.stringify(rule)])).rejects.toThrow(/Forbidden/);
  expect(await rows("attendance_checkin_schedules")).toHaveLength(0);
});
it("prevents anonymous use of every mutation wrapper", async () => {
  await db.exec("set local role anon");
  await expect(attempt("select public.save_attendance_checkin_schedule($1,$2)", [code, JSON.stringify(rule)])).rejects.toThrow(/permission denied/);
  await expect(attempt("select public.act_attendance_checkin_schedule($1,'pause')", [code])).rejects.toThrow(/permission denied/);
  await expect(attempt("select public.refresh_attendance_checkin_schedules($1)", [org])).rejects.toThrow(/permission denied/);
});
it("does not permit direct authenticated schedule writes", async () => {
  await save(); await db.exec("set local role authenticated");
  await expect(attempt("update public.attendance_checkin_schedules set paused=true")).rejects.toThrow(/permission denied/);
});
it("honors alternate-week intervals in SQL", async () => {
  await save(code, { every_weeks: 2 }); await prepare(code, "2030-01-13T09:20:00Z");
  expect(await rows("attendance_sessions")).toHaveLength(0);
  await prepare(code, "2030-01-20T09:20:00Z"); expect(await rows("attendance_sessions")).toHaveLength(1);
});
it("uses the standard-time occurrence for an autumn DST overlap", async () => {
  await db.exec("update organization_settings set timezone_name='America/New_York'");
  await save(code, { starts_on: "2030-01-01", service_time: "01:30", opens_before_minutes: 0 });
  await prepare(code, "2030-11-03T05:30:00Z"); expect(await rows("attendance_sessions")).toHaveLength(0);
  await prepare(code, "2030-11-03T06:30:00Z");
  expect((await rows("attendance_checkin_windows"))[0].opens_at).toEqual(new Date("2030-11-03T06:30:00Z"));
});
it("does not silently shift a nonexistent spring service time", async () => {
  await db.exec("update organization_settings set timezone_name='America/New_York'");
  await save(code, { service_time: "02:30" }); await prepare(code, "2030-03-10T07:05:00Z");
  expect(await rows("attendance_sessions")).toHaveLength(0);
  expect((await rows("attendance_checkin_schedules"))[0].last_error).toMatch(/does not exist/);
});
it("rejects out-of-tenant services even through a direct RPC", async () => {
  await db.exec(`update categories set org_id='${other}'`);
  await expect(attempt("select public.save_attendance_checkin_schedule($1,$2)", [code, JSON.stringify(rule)])).rejects.toThrow(/active service in this organization/);
});
it("does not reopen a soft-deleted session", async () => {
  await save(); await prepare(); await db.exec("update attendance_sessions set deleted_at=now()"); await prepare();
  expect(await rows("attendance_sessions")).toHaveLength(1);
  expect((await rows("attendance_checkin_windows"))[0].status).toBe("closed");
});
it("does not recreate a deleted auto-draft after its windows cascade away", async () => {
  await save(); await prepare(); await db.exec("delete from attendance_sessions"); await prepare();
  expect(await rows("attendance_sessions")).toHaveLength(0); expect(await rows("attendance_checkin_windows")).toHaveLength(0);
  expect(await rows("attendance_checkin_skips")).toHaveLength(1);
});
it("does not reopen a manually attached occurrence after staff closes it", async () => {
  await save();
  await db.exec(`insert into attendance_sessions(org_id,service_category_id,session_date,status) values('${org}','${service}','2030-01-06','draft')`);
  const draft = (await rows("attendance_sessions"))[0];
  await db.query("select public.open_attendance_checkin_window($1,$2,'2030-01-06T09:00:00Z','2030-01-06T11:00:00Z')", [code, draft.id]);
  await db.exec("update attendance_checkin_windows set status='closed'"); await prepare();
  expect(await rows("attendance_checkin_windows")).toHaveLength(1);
  expect((await rows("attendance_checkin_windows"))[0].status).toBe("closed");
});
it("lets staff resolve an ambiguous match by explicitly attaching the chosen draft", async () => {
  await save();
  await db.exec(`insert into attendance_sessions(org_id,service_category_id,session_date,status) values('${org}','${service}','2030-01-06','draft'),('${org}','${service}','2030-01-06','draft')`);
  await prepare();
  const chosen = (await rows("attendance_sessions"))[0];
  await db.query("select public.open_attendance_checkin_window($1,$2,'2030-01-06T09:00:00Z','2030-01-06T11:00:00Z')", [code, chosen.id]);
  expect((await rows("attendance_checkin_windows"))[0].session_id).toBe(chosen.id);
  expect((await rows("attendance_checkin_schedules"))[0].last_error).toBeNull();
});
