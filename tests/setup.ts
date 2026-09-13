process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
process.env.RESEND_API_KEY ??= "re_test_placeholder";
process.env.OPENAI_API_KEY ??= "test-placeholder";
// Unit tests must mock network boundaries; never contact a real provider/database.
globalThis.fetch = async () => { throw new Error("Unexpected network request in unit test. Mock fetch or the service boundary."); };
