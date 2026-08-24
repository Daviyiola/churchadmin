"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { supabase } from "@/lib/supabaseClient";

type InboxStatus = "all" | "new" | "reviewed" | "archived";
type Question = {
  id: string;
  key: string;
  label: string;
  type: string;
  historical: boolean;
  response_count: number;
  blank_count: number;
  unique_count: number;
  options: Array<{ label: string; count: number; percent: number }>;
  number_summary: { total: number; average: number; minimum: number; maximum: number } | null;
};
type AnalyticsPayload = {
  matching_total: number;
  counts: { new: number; reviewed: number; archived: number };
  timeline: Array<{ date: string; count: number }>;
  questions: Question[];
  question_responses: Array<{ submission_id: string; value: string | string[]; status: string; submitted_at: string }>;
  question_response_total: number;
  question_page: number;
  question_page_size: number;
};

async function bearerHeader() {
  const { data } = await supabase.auth.getSession();
  if (!data.session?.access_token) throw new Error("Your session has expired. Please sign in again.");
  return { Authorization: `Bearer ${data.session.access_token}` };
}

function formatAnswer(value: string | string[]) {
  return Array.isArray(value) ? value.join(", ") : value;
}

function friendlyType(type: string) {
  return type.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function FormResponseAnalytics({
  formId,
  view,
  status,
  search,
  from,
  to,
}: {
  formId: string;
  view: "summary" | "questions";
  status: InboxStatus;
  search: string;
  from: string;
  to: string;
}) {
  const [payload, setPayload] = useState<AnalyticsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedQuestion, setSelectedQuestion] = useState("");
  const [questionPage, setQuestionPage] = useState(1);

  const baseParams = useMemo(() => {
    const params = new URLSearchParams({ status });
    if (search) params.set("q", search);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    return params;
  }, [from, search, status, to]);

  const load = useCallback(async (question = selectedQuestion, page = questionPage) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams(baseParams);
      if (question) {
        params.set("question", question);
        params.set("question_page", String(page));
      }
      const response = await fetch(`/api/forms/${formId}/submissions/analytics?${params}`, {
        headers: await bearerHeader(), cache: "no-store",
      });
      const body = await response.json().catch(() => null) as AnalyticsPayload | { error?: string } | null;
      if (!response.ok) throw new Error(body && "error" in body ? body.error : "Unable to load response analytics.");
      const next = body as AnalyticsPayload;
      setPayload(next);
      if (!question && next.questions.length) setSelectedQuestion(next.questions[0].id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load response analytics.");
    } finally {
      setLoading(false);
    }
  }, [baseParams, formId, questionPage, selectedQuestion]);

  useEffect(() => {
    setQuestionPage(1);
    setSelectedQuestion("");
    void load("", 1);
    // Filters intentionally reset the selected question and its page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseParams, formId]);

  useEffect(() => {
    if (view === "questions" && selectedQuestion) void load(selectedQuestion, questionPage);
    // Loading is driven only by explicit question/page changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionPage, selectedQuestion, view]);

  if (loading && !payload) return <div className="rounded-3xl border bg-white p-8 text-sm text-slate-600">Building response insights…</div>;
  if (error) return <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>;
  if (!payload) return null;

  if (view === "summary") {
    const answeredQuestions = payload.questions.filter((question) => question.response_count > 0);
    return <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Matching responses", payload.matching_total],
          ["New", payload.counts.new],
          ["Reviewed", payload.counts.reviewed],
          ["Archived", payload.counts.archived],
        ].map(([label, value]) => <div key={String(label)} className="rounded-3xl border bg-white p-5 shadow-sm"><div className="text-sm text-slate-500">{label}</div><div className="mt-2 text-3xl font-semibold">{value}</div></div>)}
      </div>
      <div className="rounded-3xl border bg-white p-5 shadow-sm">
        <div className="font-semibold">Responses over time</div>
        <div className="mt-1 text-sm text-slate-500">Based on the currently applied inbox filters.</div>
        {payload.timeline.length ? <div className="mt-5 h-72"><ResponsiveContainer width="100%" height="100%"><BarChart data={payload.timeline}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="date" minTickGap={28} /><YAxis allowDecimals={false} width={32} /><Tooltip /><Bar dataKey="count" name="Responses" fill="rgb(var(--primary-rgb, 30 64 175))" radius={[7, 7, 0, 0]} /></BarChart></ResponsiveContainer></div> : <div className="mt-5 rounded-2xl border border-dashed p-8 text-center text-sm text-slate-500">No responses match these filters.</div>}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {answeredQuestions.slice(0, 6).map((question) => <QuestionCard key={question.id} question={question} compact />)}
      </div>
      {answeredQuestions.length > 6 ? <p className="text-center text-sm text-slate-500">Open Questions to explore all {answeredQuestions.length} answered questions.</p> : null}
    </div>;
  }

  const current = payload.questions.find((question) => question.id === selectedQuestion) ?? payload.questions[0];
  const currentQuestions = payload.questions.filter((question) => !question.historical);
  const historicalQuestions = payload.questions.filter((question) => question.historical);
  const pageCount = Math.max(1, Math.ceil(payload.question_response_total / payload.question_page_size));
  return <div className="grid gap-5 lg:grid-cols-[18rem_minmax(0,1fr)]">
    <aside className="h-fit rounded-3xl border bg-white p-3 shadow-sm lg:sticky lg:top-4">
      <div className="px-3 pb-2 pt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Questions</div>
      <div className="max-h-[65vh] space-y-1 overflow-y-auto">
        {currentQuestions.map((question, index) => <QuestionButton key={question.id} question={question} index={index + 1} selected={current?.id === question.id} onClick={() => { setQuestionPage(1); setSelectedQuestion(question.id); }} />)}
        {historicalQuestions.length ? <details className="pt-2"><summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-slate-500">Earlier questions ({historicalQuestions.length})</summary><div className="space-y-1">{historicalQuestions.map((question, index) => <QuestionButton key={question.id} question={question} index={currentQuestions.length + index + 1} selected={current?.id === question.id} onClick={() => { setQuestionPage(1); setSelectedQuestion(question.id); }} />)}</div></details> : null}
      </div>
    </aside>
    <section className="min-w-0 space-y-4">
      {current ? <>
        <QuestionCard question={current} />
        <div className="rounded-3xl border bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-semibold">Individual answers</h3><p className="mt-1 text-sm text-slate-500">{payload.question_response_total} answered response{payload.question_response_total === 1 ? "" : "s"}</p></div>{loading ? <span className="text-xs text-slate-500">Loading…</span> : null}</div>
          <div className="mt-4 divide-y rounded-2xl border">
            {payload.question_responses.map((response) => <div key={response.submission_id} className="p-4"><div className="whitespace-pre-wrap break-words text-sm">{formatAnswer(response.value)}</div><div className="mt-2 text-xs text-slate-500">{new Date(response.submitted_at).toLocaleString()} · <span className="capitalize">{response.status}</span></div></div>)}
            {!payload.question_responses.length ? <div className="p-8 text-center text-sm text-slate-500">No answered responses for this question.</div> : null}
          </div>
          {pageCount > 1 ? <div className="mt-4 flex items-center justify-between text-sm"><button disabled={questionPage <= 1 || loading} onClick={() => setQuestionPage((value) => Math.max(1, value - 1))} className="rounded-xl border px-3 py-1.5 disabled:opacity-40">Previous</button><span className="text-slate-500">Page {questionPage} of {pageCount}</span><button disabled={questionPage >= pageCount || loading} onClick={() => setQuestionPage((value) => value + 1)} className="rounded-xl border px-3 py-1.5 disabled:opacity-40">Next</button></div> : null}
        </div>
      </> : <div className="rounded-3xl border border-dashed bg-white p-12 text-center text-sm text-slate-500">This form has no questions to analyze.</div>}
    </section>
  </div>;
}

function QuestionButton({ question, index, selected, onClick }: { question: Question; index: number; selected: boolean; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={`w-full rounded-2xl px-3 py-2.5 text-left text-sm ${selected ? "bg-primary text-white" : "hover:bg-primary/[0.06]"}`}><span className="mr-2 text-xs opacity-70">{index}.</span>{question.label}</button>;
}

function QuestionCard({ question, compact = false }: { question: Question; compact?: boolean }) {
  const chartable = question.options.length > 0;
  return <div className="rounded-3xl border bg-white p-5 shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">{question.label}</h3><p className="mt-1 text-xs text-slate-500">{friendlyType(question.type)}{question.historical ? " · Earlier form version" : ""}</p></div><div className="text-right text-xs text-slate-500"><div>{question.response_count} answered</div><div>{question.blank_count} blank</div></div></div>
    {question.number_summary ? <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">{[["Average", question.number_summary.average], ["Total", question.number_summary.total], ["Minimum", question.number_summary.minimum], ["Maximum", question.number_summary.maximum]].map(([label, value]) => <div key={String(label)} className="rounded-2xl bg-primary/[0.04] p-3"><div className="text-xs text-slate-500">{label}</div><div className="mt-1 font-semibold">{Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}</div></div>)}</div> : null}
    {chartable ? <div className={compact ? "mt-4 h-52" : "mt-5 h-72"}><ResponsiveContainer width="100%" height="100%"><BarChart data={question.options} layout="vertical" margin={{ left: 8, right: 12 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" allowDecimals={false} /><YAxis type="category" dataKey="label" width={90} tick={{ fontSize: 11 }} /><Tooltip formatter={(value) => [Number(value), "Responses"]} /><Bar dataKey="count" fill="rgb(var(--primary-rgb, 30 64 175))" radius={[0, 7, 7, 0]} /></BarChart></ResponsiveContainer></div> : null}
    {!chartable && !question.number_summary ? <div className="mt-5 rounded-2xl bg-primary/[0.035] p-4 text-sm text-slate-600">{question.response_count ? `${question.unique_count} unique answer${question.unique_count === 1 ? "" : "s"}. ${compact ? "Open Questions to read individual answers." : "Individual answers are listed below."}` : "No answered responses yet."}</div> : null}
  </div>;
}
