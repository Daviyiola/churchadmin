import EmailPreferencesClient from "./preferences-client";

export default async function EmailPreferencesPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  return <EmailPreferencesClient token={token} />;
}
