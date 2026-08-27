export async function GET() {
  return Response.json(
    { error: "Organization discovery requires an authenticated account." },
    { status: 410 },
  );
}
