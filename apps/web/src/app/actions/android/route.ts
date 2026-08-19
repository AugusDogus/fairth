import type { AndroidAction } from "@fairth/android-rpc";
import { formString, redirectWithError, redirectWithHeaders, sameOrigin } from "@/owner-http";
import { createWebRpcCaller } from "@/trpc/context";

type WebAndroidAction = AndroidAction | "reconcile_provisioning";

function androidAction(value: string): WebAndroidAction | undefined {
  if (value === "open_google_account" || value === "open_photos" || value === "reconcile_provisioning") return value;
  return undefined;
}

async function runAndroidAction(request: Request, action: WebAndroidAction) {
  const caller = await createWebRpcCaller(request.headers);
  switch (action) {
    case "open_google_account": return caller.android.openGoogleAccount();
    case "open_photos": return caller.android.openPhotos();
    case "reconcile_provisioning": return caller.android.reconcileProvisioning();
  }
}

export async function POST(request: Request): Promise<Response> {
  const { authService, config } = await (await import("@/runtime")).getRuntime();
  if (!sameOrigin(request, config)) {
    return Response.json({ error: "invalid_origin", message: "Reload the onboarding page and submit the action from the configured Fairth origin." }, { status: 403 });
  }
  const session = await authService.auth.api.getSession({ headers: request.headers });
  if (session === null) return redirectWithHeaders(`/login?next=${encodeURIComponent("/onboarding")}`);
  const body = await request.formData();
  const action = androidAction(formString(body, "action"));
  if (action === undefined) return redirectWithError("/onboarding", "That Android setup action is not supported.");
  let result;
  try {
    result = await runAndroidAction(request, action);
  } catch (caught) {
    const detail = caught instanceof Error ? caught.message : "unknown connection error";
    return redirectWithError("/onboarding", `The Android worker is not reachable: ${detail}`);
  }
  if (!result.ok) return redirectWithError("/onboarding", result.message);
  return redirectWithHeaders("/onboarding");
}
