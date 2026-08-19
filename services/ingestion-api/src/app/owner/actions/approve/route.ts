import { formString, redirectWithError, redirectWithHeaders, sameOrigin } from "@/owner-http";

export async function POST(request: Request): Promise<Response> {
  const { getRuntime } = await import("@/runtime");
  const { authService, config } = await getRuntime();
  if (!sameOrigin(request, config)) {
    return Response.json({ error: "invalid_origin", message: "Reload the approval page and submit it from the configured Fairth origin." }, { status: 403 });
  }

  const body = await request.formData();
  const userCode = formString(body, "userCode");
  try {
    await authService.auth.api.deviceApprove({ body: { userCode }, headers: request.headers });
    return redirectWithHeaders("/owner/device-approved");
  } catch {
    return redirectWithError(`/device?user_code=${encodeURIComponent(userCode)}`, "This device could not be approved. Reload the request and verify that the code is still active.");
  }
}
