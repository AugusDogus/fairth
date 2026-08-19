export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function handle(request: Request): Promise<Response> {
  if (new URL(request.url).pathname === "/api/auth/sign-up/email") {
    return Response.json(
      { error: "not_found", message: "Owner registration is only available through the one-time setup link." },
      { status: 404 },
    );
  }
  const { authService } = await (await import("@/runtime")).getRuntime();
  return authService.auth.handler(request);
}

export { handle as GET, handle as POST };
