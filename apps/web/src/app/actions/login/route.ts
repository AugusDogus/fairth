import { formString, redirectWithError, redirectWithHeaders, safeNext, sameOrigin } from "@/owner-http";

export async function POST(request: Request): Promise<Response> {
  const { getRuntime } = await import("@/runtime");
  const { authService, config } = await getRuntime();
  if (!sameOrigin(request, config)) {
    return Response.json({ error: "invalid_origin", message: "Reload the owner sign-in page and submit it from the configured Fairth origin." }, { status: 403 });
  }

  const body = await request.formData();
  const next = safeNext(formString(body, "next"));
  try {
    const result = await authService.auth.api.signInEmail({
      body: { email: formString(body, "email"), password: formString(body, "password") },
      headers: request.headers,
      returnHeaders: true,
    });
    return redirectWithHeaders(next, result.headers);
  } catch {
    return redirectWithError(`/login?next=${encodeURIComponent(next)}`, "The email or password was not accepted.");
  }
}
