import { sameOrigin } from "@/owner-http";

export async function POST(request: Request): Promise<Response> {
  const { getRuntime } = await import("@/runtime");
  const { authService, config } = await getRuntime();
  if (!sameOrigin(request, config)) {
    return Response.json(
      { error: "invalid_origin", message: "Reload onboarding and create a new QR code." },
      { status: 403 },
    );
  }
  const session = await authService.auth.api.getSession({ headers: request.headers });
  if (session === null) {
    return Response.json(
      { error: "unauthorized", message: "Sign in to Fairth before pairing a phone." },
      { status: 401 },
    );
  }
  try {
    const pairing = await authService.createCompanionPairing(request.headers);
    return Response.json(pairing, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown pairing error";
    return Response.json(
      { error: "pairing_failed", message: `Fairth could not create a pairing code: ${detail}` },
      { status: 500 },
    );
  }
}
