export function GET() {
  return Response.json({ status: "healthy", version: process.env.VERSION ?? "unknown" });
}
