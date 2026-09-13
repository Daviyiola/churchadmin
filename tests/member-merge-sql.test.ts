import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, beforeEach, afterEach, expect, it } from "vitest";
import fixture from "./fixtures/member-merge-schema.json";

// Schema-only fixture from production: column types/defaults and unique indexes,
// plus the existing merge triggers. No customer data is copied.
const migration = readFileSync("supabase/migrations/20260913173701_repair_member_merge_relationships.sql", "utf8");
const original = readFileSync("supabase/migrations/20260721223557_add_duplicate_member_merge.sql", "utf8").split("create or replace function public.merge_members(")[1];
const org = randomUUID(), actor = randomUUID(), a = randomUUID(), b = randomUUID();
let db: PGlite;
const merge = () => db.query<{ result: { relationship_counts: Record<string, number> } }>(
  "select public.merge_members($1,$2,'{}','Duplicate record',true) as result", [a,b]);

async function seed(table: string, values: Record<string, unknown> = {}) {
  const columns = (await db.query<{column_name:string;udt_name:string}>(
    "select column_name,udt_name from information_schema.columns where table_schema='public' and table_name=$1 and is_nullable='NO' and column_default is null", [table])).rows;
  const row: Record<string, unknown> = {};
  for (const c of columns) row[c.column_name] =
    c.udt_name === "uuid" ? randomUUID() : c.udt_name === "jsonb" ? "{}" :
    c.udt_name === "bool" ? false : c.udt_name.startsWith("int") ? 1 :
    c.udt_name === "date" ? "2026-09-01" : c.udt_name === "timestamptz" ? "2026-09-01T00:00:00Z" : "test";
  Object.assign(row, values);
  const keys = Object.keys(row);
  return (await db.query<Record<string, unknown>>(
    `insert into public.${table} (${keys.join(",")}) values (${keys.map((_,i)=>"$"+(i+1)).join(",")}) returning *`, Object.values(row))).rows[0];
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth; create schema private;
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.actor',true),'')::uuid $$;
    create function public.is_org_admin(uuid) returns boolean language sql as $$ select coalesce(current_setting('test.admin',true),'true')='true' $$;`);
  for (const table of fixture.tables) {
    await db.exec(table.ddl);
    for (const index of table.indexes ?? []) await db.exec(index);
  }
  for (const fn of fixture.functions) await db.exec(fn);
  await db.exec(`create trigger members_transfer_people_memberships after update of status,merged_into_member_id on members for each row execute function transfer_people_memberships_on_merge();
    create trigger member_merges_attach_people_counts after insert on member_merges for each row execute function attach_people_counts_to_member_merge();
    create trigger members_repoint_email_contacts_after_merge after update of status,merged_into_member_id on members for each row execute function private.repoint_merged_email_contacts();
    create trigger custom_values_scope before insert or update on person_custom_field_values for each row execute function validate_person_custom_field_value_scope();`);
  await db.exec("create or replace function public.merge_members("+original);
  await db.exec(migration);
}, 60000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec("begin");
  await db.query("select set_config('test.actor',$1,true),set_config('test.admin','true',true)",[actor]);
  for (const id of [a,b]) await seed("members",{id,org_id:org,first_name:"Test",last_name:"Member",phone:"+12125550123",gender:"female",age_group:"36+"});
});
afterEach(async () => { await db.exec("rollback"); });

it("merges successfully with all newer relationship tables present and writes audit counts", async () => {
  const result = (await merge()).rows[0].result;
  expect(result.relationship_counts.community_groups).toBe(0);
  expect((await db.query("select status,merged_into_member_id from members where id=$1",[b])).rows[0]).toEqual({status:"merged",merged_into_member_id:a});
  expect((await db.query("select * from member_merge_audits")).rows).toHaveLength(1);
  expect((await db.query("select * from member_merge_membership_counts")).rows).toHaveLength(0);
});

it("preserves grants, revocations, evidence and reviewed destinations while moving member links", async () => {
  for (const status of ["granted","revoked"]) await seed("sms_contact_consents",{org_id:org,member_id:b,phone_e164:"+12125550111",status,source_type:"staff_recorded",consent_answer:"Original permission",revoked_at:status==="revoked"?"2026-09-02T00:00:00Z":null});
  await seed("sms_audience_snapshot_recipients",{org_id:org,member_id:b,phone_e164:"+12125550111",consent_basis:"individual_consent"});
  await seed("communication_audience_snapshot_recipients",{org_id:org,member_id:b,email:"original@example.com"});
  const tables=["sms_contact_consents","sms_audience_snapshot_recipients","communication_audience_snapshot_recipients"];
  const before=await Promise.all(tables.map(t=>db.query(`select to_jsonb(t)-'member_id' as evidence from ${t} t order by id`)));
  await merge();
  for (let i=0;i<tables.length;i++) {
    expect((await db.query(`select to_jsonb(t)-'member_id' as evidence from ${tables[i]} t order by id`)).rows).toEqual(before[i].rows);
    expect((await db.query(`select distinct member_id from ${tables[i]}`)).rows).toEqual([{member_id:a}]);
  }
});

it("keeps A's conflicting custom field, audits B's value, and transfers other custom fields and form history", async () => {
  const f1=randomUUID(),f2=randomUUID();
  for (const id of [f1,f2]) await seed("person_custom_fields",{id,org_id:org,name:id,field_type:"short_text"});
  await seed("person_custom_field_values",{member_id:a,org_id:org,custom_field_id:f1,value:JSON.stringify("keep")});
  await seed("person_custom_field_values",{member_id:b,org_id:org,custom_field_id:f1,value:JSON.stringify("audit")});
  await seed("person_custom_field_values",{member_id:b,org_id:org,custom_field_id:f2,value:JSON.stringify("transfer")});
  await seed("person_record_events",{member_id:b,org_id:org});
  await seed("people_membership_events",{member_id:b,org_id:org});
  await seed("form_submissions",{result_member_id:b,org_id:org});
  await merge();
  expect((await db.query("select value from person_custom_field_values order by value")).rows).toEqual([{value:"keep"},{value:"transfer"}]);
  const audit=(await db.query<{relationship_manifest:{duplicate_custom_fields_before:{value:string}[]}}>("select relationship_manifest from member_merge_audits")).rows[0].relationship_manifest;
  expect(audit.duplicate_custom_fields_before.map(x=>x.value).sort()).toEqual(["audit","transfer"]);
  for (const table of ["person_record_events","people_membership_events"])
    expect((await db.query(`select member_id from ${table}`)).rows).toEqual([{member_id:a}]);
  expect((await db.query("select result_member_id from form_submissions")).rows).toEqual([{result_member_id:a}]);
});

it("retains email opt-outs and consolidates overlapping groups/departments with correct audit counts", async () => {
  const group=randomUUID(),dept=randomUUID();
  await seed("categories",{id:dept,org_id:org,name:"Choir",type:"department"});
  for (const id of [a,b]) {
    await seed("community_group_members",{group_id:group,member_id:id,org_id:org,role:id===b?"leader":"member"});
    await seed("member_departments",{department_category_id:dept,member_id:id,org_id:org});
  }
  const contact=await seed("email_contacts",{member_id:b,org_id:org,email:"old@example.com",email_norm:"old@example.com"});
  await seed("email_topic_preferences",{contact_id:contact.id,topic:"broadcast",subscribed:false});
  const counts=(await merge()).rows[0].result.relationship_counts;
  expect(counts.community_groups).toBe(1);
  expect(counts.worker_departments).toBe(1);
  expect((await db.query("select member_id,role from community_group_members")).rows).toEqual([{member_id:a,role:"leader"}]);
  expect((await db.query("select member_id from member_departments")).rows).toEqual([{member_id:a}]);
  expect((await db.query("select member_id from email_contacts")).rows).toEqual([{member_id:a}]);
  expect((await db.query("select subscribed from email_topic_preferences")).rows).toEqual([{subscribed:false}]);
});

it("still fails closed on an unknown future relationship", async () => {
  await db.exec("create table future_relationship(member_id uuid)");
  await expect(merge()).rejects.toThrow(/Unhandled member relationship table: future_relationship/);
});
it("rejects non-admins", async () => {
  await db.exec("select set_config('test.admin','false',true)");
  await expect(merge()).rejects.toThrow(/Admin or owner role required/);
});
it("rejects cross-organization merges", async () => {
  await db.query("update members set org_id=$1 where id=$2",[randomUUID(),b]);
  await expect(merge()).rejects.toThrow(/same organization/);
});
it("does not allow anonymous execution", async () => {
  await db.exec("set local role anon");
  await expect(merge()).rejects.toThrow(/permission denied/);
});
