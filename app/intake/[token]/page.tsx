import IntakeFormClient from "./IntakeFormClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function IntakeTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <IntakeFormClient token={token} />;
}
