import { vi } from "vitest";
export type DbResult = { data: any; error: { message: string; code?: string } | null; count?: number | null };
/** Fluent, awaitable query double. Each query consumes exactly one queued result. */
export function database() {
  const queues = new Map<string, DbResult[]>();
  const calls: { table: string; method: string; args: any[] }[] = [];
  const from = vi.fn((table: string) => {
    const result = queues.get(table)?.shift() ?? { data: null, error: null };
    const query: any = { then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject) };
    for (const method of ["select", "eq", "neq", "is", "in", "or", "not", "gt", "gte", "lt", "lte", "ilike", "like", "contains", "filter", "order", "range", "limit", "single", "maybeSingle", "insert", "update", "upsert", "delete", "match"])
      query[method] = vi.fn((...args: any[]) => { calls.push({ table, method, args }); return query; });
    return query;
  });
  return { from, calls, rpc: vi.fn(), queue: (table: string, ...results: Partial<DbResult>[]) => queues.set(table, results.map(result => ({ data: null, error: null, ...result }))), reset: () => { queues.clear(); calls.length = 0; from.mockClear(); } };
}
