import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { AndroidOnboarding, AndroidStep } from "@fairth/android-rpc";
import { CircleAlertIcon, CircleCheckIcon, CircleXIcon, ExternalLinkIcon } from "lucide-react";
import { OwnerError } from "@/components/owner-error";
import { OwnerShell } from "@/components/owner-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { createWebRpcCaller } from "@/trpc/context";

type OnboardingPageProps = Readonly<{ searchParams: Promise<{ error?: string }> }>;
type OnboardingResult = Readonly<{ ok: true; value: AndroidOnboarding }> | Readonly<{ ok: false; message: string }>;

function StepIcon({ state }: Readonly<{ state: AndroidStep["state"] }>) {
  if (state === "complete") return <CircleCheckIcon className="text-primary" aria-hidden="true" />;
  if (state === "action_required") return <CircleAlertIcon className="text-amber-500" aria-hidden="true" />;
  return <CircleXIcon className="text-destructive" aria-hidden="true" />;
}

export default async function OnboardingPage({ searchParams }: OnboardingPageProps) {
  const { error } = await searchParams;
  const { getRuntime } = await import("@/runtime");
  const requestHeaders = new Headers(await headers());
  const { authService, config } = await getRuntime();
  const current = await authService.auth.api.getSession({ headers: requestHeaders });
  if (current === null) redirect(`/login?next=${encodeURIComponent("/onboarding")}`);
  let onboarding: OnboardingResult;
  try {
    onboarding = { ok: true, value: await (await createWebRpcCaller(requestHeaders)).android.status() };
  } catch (caught) {
    const detail = caught instanceof Error ? caught.message : "unknown connection error";
    onboarding = { ok: false, message: `The Android worker is not reachable: ${detail}` };
  }

  return (
    <OwnerShell eyebrow="Android onboarding" title="Finish appliance setup" description="Fairth installs and configures the Android components it can verify. Google sign-in and Photos consent stay under your control.">
      <div className="space-y-4">
        <OwnerError message={error} />
        {!onboarding.ok ? (
          <Alert variant="destructive">
            <CircleXIcon aria-hidden="true" />
            <AlertTitle>Android worker unavailable</AlertTitle>
            <AlertDescription>{onboarding.message}</AlertDescription>
          </Alert>
        ) : (
          <>
            {onboarding.value.automaticReady ? (
              <Alert>
                <CircleCheckIcon aria-hidden="true" />
                <AlertTitle>Automatic setup is complete</AlertTitle>
                <AlertDescription>Magisk, Zygisk, LSPosed, and PixelMask passed verification.</AlertDescription>
              </Alert>
            ) : (
              <form action="/actions/android" method="post">
                <input name="action" type="hidden" value="reconcile_provisioning" />
                <Button type="submit" variant="outline">Retry automatic setup</Button>
              </form>
            )}
            <div className="space-y-2">
              {onboarding.value.steps.map((step) => (
                <Item key={step.id} variant="outline">
                  <ItemMedia variant="icon"><StepIcon state={step.state} /></ItemMedia>
                  <ItemContent>
                    <ItemTitle>{step.label}</ItemTitle>
                    <ItemDescription>{step.detail}</ItemDescription>
                  </ItemContent>
                  {step.state !== "action_required" ? null : (
                    <ItemActions>
                      <form action="/actions/android" method="post">
                        <input name="action" type="hidden" value={step.action} />
                        <Button size="sm" type="submit">Open</Button>
                      </form>
                    </ItemActions>
                  )}
                </Item>
              ))}
            </div>
          </>
        )}
        <Button render={<a href={config.androidViewerUrl} rel="noreferrer" target="_blank" />} size="lg" variant="outline">
          View Android <ExternalLinkIcon data-icon="inline-end" aria-hidden="true" />
        </Button>
        <p className="text-xs text-muted-foreground">The Android viewer should remain reachable only on your LAN or tailnet, even if the upload API is public.</p>
      </div>
    </OwnerShell>
  );
}
