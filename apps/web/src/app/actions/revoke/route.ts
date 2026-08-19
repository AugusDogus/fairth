import { formString, redirectWithError, redirectWithHeaders, sameOrigin } from "@/owner-http";

export async function POST(request: Request): Promise<Response> {
  const { getRuntime } = await import("@/runtime");
  const { authService, config } = await getRuntime();
  if (!sameOrigin(request, config)) {
    return Response.json({ error: "invalid_origin", message: "Reload the devices page and submit it from the configured Fairth origin." }, { status: 403 });
  }

  const body = await request.formData();
  try {
    await authService.auth.api.revokeSession({ body: { token: formString(body, "token") }, headers: request.headers });
    return redirectWithHeaders("/devices");
  } catch {
    return redirectWithError("/devices", "The session could not be revoked. Reload the page and try again.");
  }
}
