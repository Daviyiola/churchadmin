import { describe, expect, it } from "vitest";
import { attendanceDemographicBreakdown, attendanceMonthlySummary, canUseNikkyDataTool, dataToolDefinitions, filterMemberSearchMatches, incomeMonthlyBreakdown, memberPopulationSummary } from "@/lib/server/nikky/tools";
import { canonicalizeReportParameters } from "@/lib/server/reports/registry";
import type { NikkyContext } from "@/lib/server/nikky/types";
import { normalizeNikkyMarkdown } from "@/lib/nikkyMarkdown";
import { analyticalDateClarification, isReportCreationIntent, memberMetricFromMessage, reportTypeFromMessage } from "@/lib/server/nikky/openai";
import { memberMilestoneSummary } from "@/lib/server/nikky/tools";
import { nikkyStarters } from "@/lib/nikkyStarters";
import { dateContext } from "@/lib/server/nikky/dates";

const context = (role: NikkyContext["role"]): NikkyContext => ({ accessToken:"x",supabase:{} as NikkyContext["supabase"],userId:"u",userEmail:null,organizationId:"o",organizationName:"Org",role,plan:"pro",timezone:"UTC",financeWindowStart:"2026-04-23",monthlyBudgetCents:1000 });
const report = { report_type:"quick_income",format:"csv",start_date:"2026-04-23",end_date:"2026-04-30",detail_level:"summary",include_archived:true,joined:"all",service_ids:null,category_ids:null,payment_methods:null,member_id:null };

describe("Nikky permissions and strict schemas",()=>{
  it("does not register individual giving for finance",()=>expect(dataToolDefinitions(context("finance")).some(tool=>tool.name==="individual_giving")).toBe(false));
  it("registers individual giving for admin",()=>expect(dataToolDefinitions(context("admin")).some(tool=>tool.name==="individual_giving")).toBe(true));
  it("keeps named attendance cohorts away from finance",()=>{
    const financeNames=dataToolDefinitions(context("finance")).map(tool=>tool.name);
    expect(financeNames).toContain("member_attendance_history");
    expect(financeNames).not.toContain("members_attendance_history");
    expect(financeNames).not.toContain("absent_members");
    expect(financeNames).not.toContain("sunday_member_checkins");
    expect(financeNames).not.toContain("attendance_member_changes");
    expect(financeNames).not.toContain("attendance_inconsistency");
    expect(financeNames).not.toContain("attendance_pastoral_candidates");
  });
  it("registers named attendance and giving patterns for admin",()=>{
    const names=dataToolDefinitions(context("admin")).map(tool=>tool.name);
    expect(names).toEqual(expect.arrayContaining([
      "members_attendance_history","sunday_member_checkins","attendance_member_changes",
      "attendance_inconsistency","attendance_pastoral_candidates","regular_tithe_activity",
      "donor_giving_patterns",
    ]));
  });
  it("independently rejects direct finance execution of leadership tools",()=>{
    for(const name of ["members_attendance_history","absent_members","sunday_member_checkins","attendance_member_changes","attendance_inconsistency","attendance_pastoral_candidates","individual_giving","regular_tithe_activity","donor_giving_patterns"]){
      expect(canUseNikkyDataTool(context("finance"),name)).toBe(false);
      expect(canUseNikkyDataTool(context("admin"),name)).toBe(true);
    }
  });
  it("registers aggregate demographic attendance and giving for finance",()=>{
    const names=dataToolDefinitions(context("finance")).map(tool=>tool.name);
    expect(names).toContain("attendance_demographic_summary");
    expect(names).toContain("attendance_demographic_breakdown");
    expect(names).toContain("giving_demographic_summary");
    expect(names).toContain("attendance_monthly_summary");
    expect(names).toContain("income_monthly_breakdown");
    expect(names).toContain("member_population_summary");
  });
  it("exposes strict monthly and per-session attendance breakdown arguments",()=>{
    const tool=dataToolDefinitions(context("admin")).find(item=>item.name==="attendance_demographic_breakdown");
    expect(tool?.parameters).toMatchObject({
      additionalProperties:false,
      required:["start_date","end_date","age_groups","segments","genders","group_by","interval"],
      properties:{interval:{type:"string",enum:["month","session"]}},
    });
  });
  it("never exposes organization or role as tool arguments",()=>{for(const tool of dataToolDefinitions(context("finance"))){const properties=(tool.parameters.properties??{}) as Record<string,unknown>;expect(properties.organization_id).toBeUndefined();expect(properties.role).toBeUndefined();expect(tool.parameters.additionalProperties).toBe(false);}});
  it("rejects finance Member Giving reports",()=>expect(()=>canonicalizeReportParameters(context("finance"),{...report,report_type:"member_giving"})).toThrow("not available"));
  it("rejects finance reports before the cutoff",()=>expect(()=>canonicalizeReportParameters(context("finance"),{...report,start_date:"2026-04-22"})).toThrow("begins 2026-04-23"));
  it("rejects donor targeting and unknown parameters",()=>{expect(()=>canonicalizeReportParameters(context("finance"),{...report,member_id:"11111111-1111-4111-8111-111111111111"})).toThrow("cannot target");expect(()=>canonicalizeReportParameters(context("admin"),{...report,organization_id:"other"})).toThrow("Unknown report parameter");});
});

describe("Nikky role-safe starter rotation",()=>{
  it("always returns exactly three owner/admin suggestions with attendance and giving diagnostics",()=>{
    const starters=nikkyStarters("admin",2);
    expect(starters).toHaveLength(3);
    expect(starters[0]).toMatch(/attendance|pastoral|checked in/i);
    expect(starters[1]).toMatch(/Tithe|donors|giving frequency/i);
  });
  it("never suggests named cohorts or donor patterns to finance",()=>{
    const starters=nikkyStarters("finance",2);
    expect(starters).toHaveLength(3);
    expect(starters.join(" ")).not.toMatch(/which members|Tithe givers|recurring donors|giving frequency|pastoral/i);
  });
});

describe("Nikky member resolution",()=>{
  const members=[
    {id:"1",first_name:"David",last_name:"Iyiola"},
    {id:"2",first_name:"Grace",last_name:"Iyiola"},
    {id:"3",first_name:"David",last_name:"Smith"},
  ];
  it("matches a full name across first and last name columns",()=>expect(filterMemberSearchMatches(members,"David Iyiola").map(member=>member.id)).toEqual(["1"]));
  it("keeps surname searches broad and case insensitive",()=>expect(filterMemberSearchMatches(members,"IYIOLA").map(member=>member.id)).toEqual(["1","2"]));
});

describe("Nikky demographic attendance breakdowns",()=>{
  const sessions=[
    {id:"s1",session_date:"2026-01-20",service_category_id:"c1"},
    {id:"s2",session_date:"2026-02-05",service_category_id:"c1"},
  ];
  const entries=[
    {session_id:"s1",count:3,member_id:null,entry_source:"headcount",segment:"boys",age_group:"1-12",gender:"male"},
    {session_id:"s2",count:4,member_id:null,entry_source:"headcount",segment:"girls",age_group:"1-12",gender:"female"},
  ];
  class Query {
    constructor(private table:string){}
    select(){return this;} eq(){return this;} is(){return this;} gte(){return this;}
    lte(){return this;} order(){return this;} in(){return this;} range(){return this;}
    then(resolve:(value:{data:unknown[];error:null})=>void){
      resolve({
        data:this.table==="attendance_sessions"?sessions:this.table==="attendance_entries"?entries:[{id:"c1",name:"Sunday Service"}],
        error:null,
      });
    }
  }
  const breakdownContext={organizationId:"org",supabase:{from:(table:string)=>new Query(table)}} as never;
  const args={start_date:"2026-01-15",end_date:"2026-02-10",age_groups:null,segments:["boys","girls"],genders:null,group_by:"segment"};

  it("returns every requested segment for every month, including zeroes",async()=>{
    const output=await attendanceDemographicBreakdown(breakdownContext,{...args,interval:"month"});
    expect(output.outcome).toBe("ok");
    expect((output.data as {rows:unknown[]}).rows).toEqual([
      {month:"2026-01",group:"boys",attendance_count:3,entry_record_count:1,matching_session_count:1,published_session_count:1},
      {month:"2026-01",group:"girls",attendance_count:0,entry_record_count:0,matching_session_count:0,published_session_count:1},
      {month:"2026-02",group:"boys",attendance_count:0,entry_record_count:0,matching_session_count:0,published_session_count:1},
      {month:"2026-02",group:"girls",attendance_count:4,entry_record_count:1,matching_session_count:1,published_session_count:1},
    ]);
  });

  it("returns zero-filled rows for every published session",async()=>{
    const output=await attendanceDemographicBreakdown(breakdownContext,{...args,interval:"session"});
    expect((output.data as {rows:Array<Record<string,unknown>>}).rows).toMatchObject([
      {session_id:"s1",date:"2026-01-20",service:"Sunday Service",group:"boys",attendance_count:3},
      {session_id:"s1",date:"2026-01-20",service:"Sunday Service",group:"girls",attendance_count:0},
      {session_id:"s2",date:"2026-02-05",service:"Sunday Service",group:"boys",attendance_count:0},
      {session_id:"s2",date:"2026-02-05",service:"Sunday Service",group:"girls",attendance_count:4},
    ]);
  });

  it("returns zero-filled monthly attendance totals",async()=>{
    const output=await attendanceMonthlySummary(breakdownContext,{start_date:"2026-01-01",end_date:"2026-03-31"});
    expect((output.data as {months:unknown[]}).months).toEqual([
      {month:"2026-01",attendance_count:3,published_session_count:1,average_per_session:3},
      {month:"2026-02",attendance_count:4,published_session_count:1,average_per_session:4},
      {month:"2026-03",attendance_count:0,published_session_count:0,average_per_session:0},
    ]);
  });
});

describe("Nikky monthly giving and member population summaries",()=>{
  class Query {
    constructor(private table:string){}
    select(){return this;} eq(){return this;} in(){return this;} gte(){return this;}
    lte(){return this;} limit(){return this;}
    then(resolve:(value:{data:unknown[];error:null})=>void){
      if(this.table==="income_entries")resolve({data:[
        {session_date:"2026-01-10",income_category_id:"c1",service_category_id:"s1",payment_method:"cash",amount_cents:100},
        {session_date:"2026-02-10",income_category_id:"c2",service_category_id:"s1",payment_method:"online",amount_cents:250},
      ],error:null});
      else if(this.table==="members")resolve({data:[
        {status:"active",age_group:"18-35",segment:null,gender:"female",department_category_id:"d1"},
        {status:"archived",age_group:"36+",segment:"men",gender:"male",department_category_id:null},
      ],error:null});
      else resolve({data:[{id:"c1",name:"Offering"},{id:"c2",name:"Tithe"},{id:"d1",name:"Choir"}],error:null});
    }
  }
  const summaryContext={...context("admin"),supabase:{from:(table:string)=>new Query(table)}} as never;

  it("returns a zero-filled month-by-category giving matrix",async()=>{
    const output=await incomeMonthlyBreakdown(summaryContext,{start_date:"2026-01-01",end_date:"2026-03-31",group_by:"category"});
    const data=output.data as {monthly_totals:unknown[];breakdown:Array<Record<string,unknown>>};
    expect(data.monthly_totals).toEqual([
      {month:"2026-01",total_cents:100,record_count:1},
      {month:"2026-02",total_cents:250,record_count:1},
      {month:"2026-03",total_cents:0,record_count:0},
    ]);
    expect(data.breakdown).toContainEqual({month:"2026-03",group:"Offering",total_cents:0,record_count:0});
    expect(data.breakdown).toContainEqual({month:"2026-03",group:"Tithe",total_cents:0,record_count:0});
  });

  it("returns current canonical population dimensions",async()=>{
    const output=await memberPopulationSummary(summaryContext);
    expect(output.data).toMatchObject({
      total_members:2,
      by_status:[{group:"active",member_count:1},{group:"archived",member_count:1}],
      by_segment:[{group:"men",member_count:1},{group:"women",member_count:1}],
      by_department:[{group:"Choir",member_count:1},{group:"Unspecified",member_count:1}],
    });
  });
});

describe("Nikky analytical date clarification",()=>{
  it("asks for missing financial and attendance ranges",()=>{
    expect(analyticalDateClarification(context("admin"),"What month had the highest giving across each category?")).toBe("What exact date range should I use for that financial analysis?");
    expect(analyticalDateClarification(context("admin"),"What month had the highest attendance?")).toBe("What exact date range should I use for that attendance analysis?");
  });
  it("does not ask again when the range is deterministic",()=>{
    expect(analyticalDateClarification(context("admin"),"What month had the highest giving this year?")).toBeNull();
    expect(analyticalDateClarification(context("admin"),"Which registered members have not checked in during the last four Sundays?")).toBeNull();
    expect(analyticalDateClarification(context("admin"),"Whose attendance declined in the latest three completed months compared with the previous three?")).toBeNull();
    expect(analyticalDateClarification(context("admin"),"Which members may need a pastoral follow-up based on recorded attendance?")).toBeNull();
  });
  it("derives completed periods and four prior Sundays from organization today",()=>{
    const dates=dateContext(context("admin"));
    expect(dates.last_four_sundays).toHaveLength(4);
    expect(dates.latest_three_completed_months.start_date).toMatch(/^\d{4}-\d{2}-01$/);
    expect(dates.previous_three_completed_months.end_date < dates.latest_three_completed_months.start_date).toBe(true);
  });
});

describe("Nikky Markdown normalization",()=>{
  it("repairs missing prose spacing around bold text",()=>expect(normalizeNikkyMarkdown("Attendance is**6**across**1 session**.")).toBe("Attendance is **6** across **1 session**."));
  it("adds spacing before a timezone parenthesis",()=>expect(normalizeNikkyMarkdown("For **July 1–21, 2026**(America/New_York)")).toBe("For **July 1–21, 2026** (America/New_York)"));
  it("repairs spaces inside bold markers",()=>expect(normalizeNikkyMarkdown("Total: ** $13,303.00 **.")).toBe("Total: **$13,303.00**."));
  it("splits compact markdown table rows onto separate lines",()=>{
    const compact="| Month | Giving | Change | |---|---:|---:| | January | $4,344.15 | â€” | | February | $39,520.98 | +809.7% |";
    expect(normalizeNikkyMarkdown(compact)).toBe([
      "| Month | Giving | Change |",
      "|---|---:|---:|",
      "| January | $4,344.15 | â€” |",
      "| February | $39,520.98 | +809.7% |",
    ].join("\n"));
  });
});

describe("Nikky report routing",()=>{
  it("recognizes report creation requests",()=>expect(isReportCreationIntent("Okay, make a Quick Income report for this month")).toBe(true));
  it("recognizes polite get-report requests",()=>{
    expect(isReportCreationIntent("Could I get an income statement for this year?")).toBe(true);
    expect(isReportCreationIntent("Could I get a new convert and baptism report for this year?")).toBe(true);
  });
  it("does not treat report catalog questions as generation",()=>expect(isReportCreationIntent("What types of reports can you make?")).toBe(false));
  it("resolves supported report names",()=>{
    expect(reportTypeFromMessage("make an income statement report")).toBe("income_statement");
    expect(reportTypeFromMessage("generate a quick income CSV")).toBe("quick_income");
    expect(reportTypeFromMessage("Could I get a new convert and baptism report for this year?")).toBe("combined");
  });
});

describe("Nikky member metric routing",()=>{
  it("recognizes member milestones and common typing mistakes",()=>{
    expect(memberMetricFromMessage("how many new converts this year?")).toBe("new_converts");
    expect(memberMetricFromMessage("how many baptisms this yeaar?")).toBe("baptisms");
    expect(memberMetricFromMessage("how many new memebrs this year?")).toBe("new_members");
    expect(memberMetricFromMessage("what is a member profile?")).toBeNull();
  });
  it("counts canonical member milestones by active and archived status",async()=>{
    class CountQuery {
      filters:Record<string,unknown>={};
      select(){return this;} eq(field:string,value:unknown){this.filters[field]=value;return this;}
      gte(field:string,value:unknown){this.filters[`${field}:gte`]=value;return this;}
      lte(field:string,value:unknown){this.filters[`${field}:lte`]=value;return this;}
      then(resolve:(value:{count:number;error:null})=>void){
        const status=String(this.filters.status); let count=status==="active"?10:2;
        if("joined_at:gte" in this.filters)count=status==="active"?3:1;
        if("born_again_date:gte" in this.filters)count=status==="active"?2:0;
        if("baptism_date:gte" in this.filters)count=status==="active"?4:1;
        resolve({count,error:null});
      }
    }
    const context={organizationId:"org",supabase:{from:()=>new CountQuery()}} as never;
    const output=await memberMilestoneSummary(context,{start_date:"2026-01-01",end_date:"2026-07-21"});
    expect(output.outcome).toBe("ok");
    expect(output.data).toMatchObject({current_members:{total:12},new_members:{total:4},new_converts:{total:2},baptisms:{total:5}});
  });
});
