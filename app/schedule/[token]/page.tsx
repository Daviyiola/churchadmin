// app/schedule/[token]/page.tsx
import PublicScheduleClient from "./public-client";

export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const clean = String(token ?? "").trim();
  return <PublicScheduleClient token={clean} />;
}
