import { formString, redirectWithError, redirectWithHeaders, sameOrigin } from "@/owner-http";

export async function POST(request: Request): Promise<Response> {
  const { getRuntime } = await import("@/runtime");
  const { authService, config } = await getRuntime();
  if (!sameOrigin(request, config)) {
    return Response.json({ error: "invalid_origin", message: "Reload the owner setup page and submit it from the configured Fairth origin." }, { status: 403 });
  }

  const body = await request.formData();
  const token = formString(body, "token");
  const result = await authService.createOwner({
    token,
    name: formString(body, "name"),
    email: formString(body, "email"),
    password: formString(body, "password"),
  });
  if (!result.ok) {
    return redirectWithError(`/owner/setup?token=${encodeURIComponent(token)}`, result.message);
  }
  return redirectWithHeaders("/owner/devices", result.headers);
}
