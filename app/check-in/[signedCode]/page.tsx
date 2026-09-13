import AttendanceCheckinClient from "./AttendanceCheckinClient";

export default async function AttendanceCheckinPage({ params }: { params: Promise<{ signedCode: string }> }) {
  const { signedCode } = await params;
  return <AttendanceCheckinClient signedCode={signedCode} />;
}
