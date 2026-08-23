"use client";

import UnifiedFirstTimerIntakeClient from "@/components/forms/UnifiedFirstTimerIntakeClient";

export default function IntakeFormClient({ token }: { token: string }) {
  return <UnifiedFirstTimerIntakeClient
    lookupUrl={`/api/intake/lookup?token=${encodeURIComponent(token)}`}
    submitUrl="/api/intake/submit"
    submitContext={{ token }}
    expiringLink
  />;
}
