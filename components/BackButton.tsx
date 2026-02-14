"use client";

import { useRouter } from "next/navigation";

export default function BackButton() {
  const router = useRouter();

  return (
    <button
      onClick={() => router.back()}
      className="inline-flex items-center gap-2 rounded-2xl border px-4 py-2 text-sm font-medium hover:bg-slate-50"
    >
      Back
    </button>
  );
}
