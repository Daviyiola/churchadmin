import { describe, expect, it, vi } from "vitest";
const state=vi.hoisted(()=>({org:"org&special" as string|null}));
vi.mock("@/lib/auth",()=>({getActiveOrgId:()=>state.org}));
import { buildQuickReportPrintUrl } from "@/lib/reports/quick/printUrl";
import { buildMemberGivingPrintUrl } from "@/lib/reports/members/printUrl";
import { buildIncomeStatementPrintUrl } from "@/lib/reports/income-statement/printUrl";
import { buildFirstTimersPrintUrl } from "@/lib/reports/first-timers/printUrl";
import { buildConvertsBaptismsPrintUrl } from "@/lib/reports/converts-baptisms/printUrl";
const query=(url:string)=>new URL(url,"http://localhost").searchParams;
describe("report print URLs preserve selected filters",()=>{
 it("encodes tenant IDs and repeated quick-report filters",()=>{const q=query(buildQuickReportPrintUrl({mode:"expense",start:"2026-01-01",end:"2026-01-31",vendor:["A&B","C"],method:["cash","online"],expense_sort:"category"}));expect(q.get("org")).toBe("org&special");expect(q.getAll("vendor")).toEqual(["A&B","C"]);expect(q.getAll("method")).toEqual(["cash","online"]);});
 it("keeps multiple selected members and categories",()=>{const q=query(buildMemberGivingPrintUrl({org:"org",mode:"monthly",start:"2026-01-01",end:"2026-01-31",member_ids:["a","b"],category_ids:["c","d"],service_ids:["s"],payment_methods:["online"]}));expect(q.getAll("member_id")).toEqual(["a","b"]);expect(q.getAll("category_id")).toEqual(["c","d"]);});
 it("keeps income statement filters separate",()=>{const q=query(buildIncomeStatementPrintUrl({start_date:"2026-01-01",end_date:"2026-01-31",income_category_ids:["i"],expense_category_ids:["e"],service_ids:["s"],payment_methods:["cash"]}));expect(q.getAll("income_category_id")).toEqual(["i"]);expect(q.getAll("expense_category_id")).toEqual(["e"]);});
 it("defaults visitor filters and respects explicit archival exclusion",()=>{const args={org:"org",start:"2026-01-01",end:"2026-01-31"};expect(query(buildFirstTimersPrintUrl(args)).get("include_archived")).toBe("1");expect(query(buildFirstTimersPrintUrl({...args,include_archived:false,joined:"joined"})).get("joined")).toBe("joined");});
 it("defaults sacrament reports to combined",()=>{const args={org:"org",start:"2026-01-01",end:"2026-01-31"};expect(query(buildConvertsBaptismsPrintUrl(args)).get("report_type")).toBe("combined");expect(query(buildConvertsBaptismsPrintUrl({...args,include_archived:false})).get("include_archived")).toBe("0");});
 it("rejects printing without a selected workspace",()=>{state.org=null;try{expect(()=>buildQuickReportPrintUrl({mode:"income",start:"2026-01-01",end:"2026-01-31"})).toThrow("No active");expect(()=>buildIncomeStatementPrintUrl({start_date:"2026-01-01",end_date:"2026-01-31"})).toThrow("No active");}finally{state.org="org&special";}});
});
