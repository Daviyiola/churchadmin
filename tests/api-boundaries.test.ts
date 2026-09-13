import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { database } from "./helpers/database";
const state = vi.hoisted(() => ({ db: null as any, getUser: vi.fn(), send: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabaseAdmin", () => ({ supabaseAdmin: { from: (...args: any[]) => state.db.from(...args), rpc: state.rpc, auth: { getUser: state.getUser, admin: { getUserById: state.getUser } } } }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ from: (...args: any[]) => state.db.from(...args), rpc: state.rpc, auth: { getUser: state.getUser } }) }));
vi.mock("@/lib/server/email/sender", async importOriginal => ({ ...await importOriginal<object>(), sendManagedEmail: state.send, verifyResendWebhook: vi.fn(() => { throw new Error("Invalid webhook"); }) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: vi.fn(), delete: vi.fn() }) }));
function routes(dir: string): string[] { return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? routes(join(dir, entry.name)) : entry.name === "route.ts" ? [join(dir, entry.name).replaceAll("\\", "/")] : []); }
const cases = routes("app/api").flatMap(path => [...readFileSync(path, "utf8").matchAll(/export\s+async\s+function\s+(GET|POST|PATCH|PUT|DELETE)\s*\(/g)].map(match => ({ path, method: match[1] })));
// The billing plan catalog intentionally allows anonymous reads.
const publicCatalog = new Set(["app/api/billing/plans/route.ts"]);
beforeEach(() => { state.db = database(); state.getUser.mockResolvedValue({ data: { user: null }, error: { message: "Unauthorized" } }); state.rpc.mockResolvedValue({ data: null, error: { message: "Invalid request" } }); state.send.mockClear(); });
describe.each(cases)("API boundary: $method $path", ({ path, method }) => {
  let routeModule: Record<string, (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>>;
  // Cold transforms and coverage instrumentation are setup, not handler runtime.
  beforeAll(async () => {
    routeModule = await import(/* @vite-ignore */ `../${path}`);
  }, 60_000);

  it("handles an invalid/anonymous request without side effects", async () => {
    const params = Object.fromEntries([...path.matchAll(/\[([^\]]+)\]/g)].map(match => [match[1], "invalid-token"]));
    const request = new Request(`http://localhost/${path.replace("/route.ts", "")}`, { method, ...(method === "GET" ? {} : { headers: { "Content-Type": "application/json" }, body: "{}" }) });
    const response: Response = await routeModule[method](request, { params: Promise.resolve(params) });
    if (publicCatalog.has(path)) expect(response.status).toBe(200);
    else if (path.includes("email/unsubscribe") && method === "GET") { expect(response.status).toBe(303); expect(response.headers.get("location")).toContain("/email/preferences"); }
    else if (path === "app/api/billing/webhook/route.ts") expect(response.status).toBe(503); // Missing Stripe configuration.
    else if (path === "app/api/reports/quick/pdf/route.ts" && method === "GET") expect(response.status).toBe(501); // Explicitly unsupported method.
    else { expect(response.status, `${path}: ${await response.clone().text()}`).toBeGreaterThanOrEqual(400); expect(response.status).toBeLessThan(500); }
    expect(state.send).not.toHaveBeenCalled();
    expect(state.db.calls.filter((call: any) => ["insert", "update", "upsert", "delete"].includes(call.method))).toEqual([]);
  });
});
