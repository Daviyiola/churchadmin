"use client";

import UnifiedFirstTimerIntakeClient from "@/components/forms/UnifiedFirstTimerIntakeClient";

export default function CampaignIntakeClient({ slug }: { slug: string }) {
  return <UnifiedFirstTimerIntakeClient
    lookupUrl={`/api/intake/campaign/lookup?slug=${encodeURIComponent(slug)}`}
    submitUrl="/api/intake/campaign/submit"
    submitContext={{ slug }}
  />;
}
