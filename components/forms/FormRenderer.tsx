"use client";

import BrandLogo from "@/components/BrandLogo";
import Image from "next/image";
import { useState } from "react";
import { daysForMonth, monthDayValue, parseMonthDay } from "@/lib/people/birthDate";

export type RenderableFormField = {
  key: string;
  type:
    | "short_text"
    | "long_text"
    | "email"
    | "phone"
    | "number"
    | "date"
    | "month_day"
    | "single_choice"
    | "multiple_choice"
    | "dropdown"
    | "yes_no";
  label: string;
  help_text: string;
  placeholder: string;
  required: boolean;
  options: string[];
  width: "full" | "half";
};

type Props = {
  title: string;
  description?: string | null;
  fields: RenderableFormField[];
  organizationName?: string;
  organizationLogoUrl?: string | null;
  compact?: boolean;
  previewMode?: boolean;
  onFieldSelect?: (fieldKey: string) => void;
  onSubmitAnswers?: (
    answers: Record<string, string | string[]>,
    website: string,
  ) => void;
  submitting?: boolean;
  initialAnswers?: Record<string, string | string[]>;
  readOnlyFieldKeys?: string[];
};

const controlClass =
  "mt-2 w-full rounded-xl border bg-white px-3 py-2.5 text-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-100";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function MonthDayControl({
  name,
  initialValue,
  disabled,
  readOnly,
  required,
}: {
  name: string;
  initialValue: string;
  disabled: boolean;
  readOnly: boolean;
  required: boolean;
}) {
  const initial = parseMonthDay(initialValue);
  const [month, setMonth] = useState(initial?.month ?? 0);
  const [day, setDay] = useState(initial?.day ?? 0);

  const maxDay = daysForMonth(month);
  const value = monthDayValue(month || null, day || null);
  const locked = disabled || readOnly;

  return <div className="mt-2 grid grid-cols-2 gap-2">
    <input type="hidden" name={name} value={value} />
    <select
      aria-label="Birth month"
      disabled={locked}
      required={required || day > 0}
      value={month || ""}
      onChange={(event) => {
        const nextMonth = Number(event.target.value);
        setMonth(nextMonth);
        if (day > daysForMonth(nextMonth)) setDay(0);
      }}
      className={`${controlClass} mt-0 ${readOnly ? "bg-slate-100 text-slate-600" : ""}`}
    >
      <option value="">Month</option>
      {MONTHS.map((label, index) => <option key={label} value={index + 1}>{label}</option>)}
    </select>
    <select
      aria-label="Birth day"
      disabled={locked || !month}
      required={required || month > 0}
      value={day || ""}
      onChange={(event) => setDay(Number(event.target.value))}
      className={`${controlClass} mt-0 ${readOnly ? "bg-slate-100 text-slate-600" : ""}`}
    >
      <option value="">Day</option>
      {Array.from({ length: maxDay }, (_, index) => index + 1).map((value) => <option key={value} value={value}>{value}</option>)}
    </select>
  </div>;
}

function FieldControl({ field, disabled, readOnly, initialValue }: {
  field: RenderableFormField;
  disabled: boolean;
  readOnly: boolean;
  initialValue?: string | string[];
}) {
  const initialText = typeof initialValue === "string" ? initialValue : "";
  if (field.type === "month_day") {
    return <MonthDayControl
      name={field.key}
      initialValue={initialText}
      disabled={disabled}
      readOnly={readOnly}
      required={field.required}
    />;
  }
  if (field.type === "long_text") {
    return <textarea disabled={disabled} readOnly={readOnly} defaultValue={initialText} maxLength={5000} name={field.key} required={field.required} rows={4} placeholder={field.placeholder} className={`${controlClass} ${readOnly ? "bg-slate-100 text-slate-600" : ""}`} />;
  }
  if (field.type === "single_choice" || field.type === "multiple_choice") {
    const inputType = field.type === "single_choice" ? "radio" : "checkbox";
    return <div className="mt-2 space-y-2">
      {field.options.map((option) => <label key={option} className="flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm hover:bg-slate-50">
        <input disabled={disabled || readOnly} defaultChecked={Array.isArray(initialValue) ? initialValue.includes(option) : initialText === option} type={inputType} name={field.key} value={option} required={field.required && inputType === "radio"} className="mt-0.5" />
        <span>{option}</span>
      </label>)}
    </div>;
  }
  if (field.type === "dropdown") {
    return <select disabled={disabled || readOnly} name={field.key} required={field.required} defaultValue={initialText} className={`${controlClass} ${readOnly ? "bg-slate-100 text-slate-600" : ""}`}>
      <option value="" disabled>Select an option</option>
      {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
    </select>;
  }
  if (field.type === "yes_no") {
    return <div className="mt-2 flex gap-3">
      {["Yes", "No"].map((option) => <label key={option} className="flex flex-1 items-center gap-2 rounded-xl border px-3 py-2.5 text-sm hover:bg-slate-50">
        <input disabled={disabled || readOnly} defaultChecked={initialText === option.toLowerCase()} type="radio" name={field.key} value={option.toLowerCase()} required={field.required} />
        {option}
      </label>)}
    </div>;
  }

  const inputType = field.type === "short_text"
    ? "text"
    : field.type === "phone"
      ? "tel"
      : field.type;
  return <input disabled={disabled} readOnly={readOnly} defaultValue={initialText} maxLength={1000} type={inputType} name={field.key} required={field.required} placeholder={field.placeholder} className={`${controlClass} ${readOnly ? "bg-slate-100 text-slate-600" : ""}`} />;
}

export default function FormRenderer({
  title,
  description,
  fields,
  organizationName,
  organizationLogoUrl,
  compact = false,
  previewMode = false,
  onFieldSelect,
  onSubmitAnswers,
  submitting = false,
  initialAnswers = {},
  readOnlyFieldKeys = [],
}: Props) {
  return <div className={`overflow-hidden border bg-white shadow-sm ${compact ? "rounded-2xl" : "rounded-3xl"}`}>
    {organizationName ? <header className={`border-b bg-white ${compact ? "p-4" : "px-6 py-5 sm:px-8"}`}>
      <div className="flex items-center gap-3">
        <div className={`flex shrink-0 items-center justify-center overflow-hidden ${compact ? "h-10 w-10" : "h-14 w-14"}`}>
          {organizationLogoUrl ? <Image
            src={organizationLogoUrl}
            alt={`${organizationName} logo`}
            width={compact ? 40 : 56}
            height={compact ? 40 : 56}
            className="h-full w-full object-contain"
          /> : <BrandLogo size={compact ? 40 : 56} />}
        </div>
        <div className={`font-semibold leading-tight tracking-tight text-slate-900 ${compact ? "text-xl" : "text-2xl sm:text-3xl"}`}>
          {organizationName}
        </div>
      </div>
    </header> : null}

    <form onSubmit={(event) => {
      event.preventDefault();
      if (previewMode || !onSubmitAnswers) return;
      const formData = new FormData(event.currentTarget);
      const answers: Record<string, string | string[]> = { ...initialAnswers };
      for (const field of fields) {
        if (field.type === "multiple_choice") {
          answers[field.key] = formData.getAll(field.key).map(String);
        } else {
          answers[field.key] = String(formData.get(field.key) ?? "");
        }
      }
      onSubmitAnswers(answers, String(formData.get("website") ?? ""));
    }} className={compact ? "p-4" : "p-6 sm:p-8"}>
      <input className="absolute -left-[10000px] h-px w-px" tabIndex={-1} autoComplete="off" name="website" aria-hidden="true" />
      <div className={compact ? "mb-5" : "mb-8"}>
        <h1 className={compact ? "text-lg font-semibold" : "text-xl font-semibold tracking-tight sm:text-2xl"}>{title || "Untitled form"}</h1>
        {description ? <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p> : null}
      </div>

      <div className={compact ? "grid grid-cols-1 gap-4" : "grid grid-cols-1 gap-x-5 gap-y-6 md:grid-cols-2"}>
        {fields.length === 0 ? <p className="text-sm text-slate-400 md:col-span-2">Questions will appear here.</p> : fields.map((field) => <div
          key={field.key}
          title={onFieldSelect ? "Jump to this question in the editor" : undefined}
          onClick={onFieldSelect ? () => onFieldSelect(field.key) : undefined}
          className={`${compact
            ? "col-span-1"
            : field.width === "full"
              ? "md:col-span-2"
              : "md:col-span-1"} ${onFieldSelect ? "-m-2 cursor-pointer rounded-xl p-2 transition hover:bg-blue-50 hover:ring-1 hover:ring-blue-200" : ""}`}
        >
          <label className="text-sm font-semibold text-slate-800">
            {field.label || "Untitled question"}
            {field.required ? <span className="ml-1 text-rose-500">*</span> : null}
          </label>
          {field.help_text ? <p className="mt-1 text-xs leading-5 text-slate-500">{field.help_text}</p> : null}
          <FieldControl field={field} disabled={submitting} readOnly={readOnlyFieldKeys.includes(field.key)} initialValue={initialAnswers[field.key]} />
        </div>)}
      </div>

      {!compact ? <div className="mt-8 border-t pt-5">
        <button type="submit" disabled={previewMode || submitting} className="rounded-2xl bg-primary px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">
          {previewMode ? "Submission disabled in preview" : submitting ? "Submitting…" : "Submit"}
        </button>
      </div> : null}
    </form>
  </div>;
}
