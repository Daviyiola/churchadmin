import PublicFormClient from "./PublicFormClient";

export default async function PublicFormPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <PublicFormClient slug={slug} />;
}
