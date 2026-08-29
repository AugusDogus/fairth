import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { AndroidOnboarding, AndroidStep } from "@fairth/android-rpc";
import { ArrowRightIcon, ChevronDownIcon, CircleAlertIcon, CircleCheckIcon, CircleXIcon, ExternalLinkIcon } from "lucide-react";
import { OwnerError } from "@/components/owner-error";
import { OwnerShell } from "@/components/owner-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { createWebRpcCaller } from "@/trpc/context";
import { PairCompanion } from "./pair-companion";
import { SetupAction } from "./setup-action";

type OnboardingPageProps = Readonly<{ searchParams: Promise<{ error?: string }> }>;
type OnboardingResult = Readonly<{ ok: true; value: AndroidOnboarding }> | Readonly<{ ok: false; message: string }>;

function StepIcon({ state }: Readonly<{ state: AndroidStep["state"] }>) {
  if (state === "complete") return <CircleCheckIcon className="size-4 text-primary" aria-hidden="true" />;
  if (state === "action_required") return <CircleAlertIcon className="size-4 text-amber-500" aria-hidden="true" />;
  return <CircleXIcon className="size-4 text-destructive" aria-hidden="true" />;
}

function completedSteps(onboarding: AndroidOnboarding): number {
  return onboarding.steps.filter((step) => step.state === "complete").length;
}

export default async function OnboardingPage({ searchParams }: OnboardingPageProps) {
  const { error } = await searchParams;
  const { getRuntime } = await import("@/runtime");
  const requestHeaders = new Headers(await headers());
  const { authService, companionPresence, config } = await getRuntime();
  const current = await authService.auth.api.getSession({ headers: requestHeaders });
  if (current === null) redirect(`/login?next=${encodeURIComponent("/onboarding")}`);
  const companionSessionTokens = authService.activeCompanionSessionTokens(current.user.id);
  const companionReady = (await Promise.all(companionSessionTokens.map((token) => companionPresence.isRecent(token)))).some(Boolean);
  let onboarding: OnboardingResult;
  try {
    onboarding = { ok: true, value: await (await createWebRpcCaller(requestHeaders)).android.status() };
  } catch (caught) {
    const detail = caught instanceof Error ? caught.message : "unknown connection error";
    onboarding = { ok: false, message: `The Android worker is not reachable: ${detail}` };
  }
  const androidReady = onboarding.ok && onboarding.value.steps.every((step) => step.state === "complete");
  const setupComplete = companionReady && androidReady;
  const nextStep = onboarding.ok ? onboarding.value.steps.find((step) => step.state === "action_required") : undefined;
  const completeCount = onboarding.ok ? completedSteps(onboarding.value) + (companionReady ? 1 : 0) : 0;
  const totalCount = onboarding.ok ? onboarding.value.steps.length + 1 : 1;

  return (
    <OwnerShell
      description={setupComplete ? "Your phone and Google Photos are connected." : "Pair your phone, then finish Android and Google Photos setup."}
      heading="hidden"
      title={setupComplete ? "Fairth is ready" : "Finish setup"}
      width="wide"
    >
      <div className="grid items-start gap-6 pt-7 sm:pt-9 md:grid-cols-[minmax(0,1fr)_minmax(18rem,23rem)]">
          <div>
            <header className="pb-7 sm:pb-8">
              <h1 className="text-3xl font-semibold tracking-tight">{setupComplete ? "Fairth is ready" : "Finish setup"}</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                {setupComplete ? "Your phone and Google Photos are connected." : "Pair your phone, then finish Android and Google Photos setup."}
              </p>
            </header>
            <OwnerError message={error} />
            <section className="border-y border-border/70 py-5 sm:py-6">
            {setupComplete ? (
            <div>
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <CircleCheckIcon className="size-4" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="font-semibold">Phone and Google Photos connected</h2>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">Automatic camera backup is ready.</p>
                </div>
              </div>
              <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                <Button render={<a href="/devices" />} size="lg">
                  Manage devices <ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
                </Button>
                <Button render={<a href={config.androidViewerUrl} rel="noreferrer" target="_blank" />} size="lg" variant="outline">
                  Open Android <ExternalLinkIcon data-icon="inline-end" aria-hidden="true" />
                </Button>
              </div>
            </div>
          ) : !companionReady ? (
            <PairCompanion />
          ) : (
            <div>
              <div className="flex items-start gap-3">
                <CircleCheckIcon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
                <div className="flex-1">
                  <h2 className="font-semibold">Phone paired</h2>
                  {!onboarding.ok ? (
                    <p className="mt-1 text-sm leading-6 text-destructive">Android is not reachable. Open Setup details for the error.</p>
                  ) : !onboarding.value.automaticReady ? (
                    <div className="mt-3">
                      <p className="mb-3 text-sm leading-6 text-muted-foreground">Automatic Android setup needs another attempt.</p>
                      <form action="/actions/android" method="post">
                        <input name="action" type="hidden" value="reconcile_provisioning" />
                        <Button type="submit" variant="outline">Retry Android setup</Button>
                      </form>
                    </div>
                  ) : nextStep?.state === "action_required" ? (
                    <div className="mt-3">
                      <p className="text-sm font-medium">Next: {nextStep.label}</p>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">{nextStep.detail}</p>
                      <SetupAction action={nextStep.action} autoConfigure={error === undefined} />
                    </div>
                  ) : (
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">Open Setup details to resolve the remaining Android check.</p>
                  )}
                </div>
              </div>
            </div>
          )}

          <details className="group mt-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-2 text-sm font-medium text-muted-foreground select-none hover:text-foreground [&::-webkit-details-marker]:hidden">
              <span>{completeCount} of {totalCount} setup checks complete</span>
              <ChevronDownIcon className="size-4 text-muted-foreground transition-transform duration-200 ease-out group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
            </summary>

            <div className="mt-2 border-t border-border/70 pt-2">
              <div className="space-y-4">
                {!onboarding.ok ? (
                  <Alert variant="destructive">
                    <CircleXIcon aria-hidden="true" />
                    <AlertTitle>Android worker unavailable</AlertTitle>
                    <AlertDescription>{onboarding.message}</AlertDescription>
                  </Alert>
                ) : (
                  <>
                    {onboarding.value.automaticReady ? null : (
                      <form action="/actions/android" method="post">
                        <input name="action" type="hidden" value="reconcile_provisioning" />
                        <Button type="submit" variant="outline">Retry automatic setup</Button>
                      </form>
                    )}
                    <div className="divide-y divide-border/70">
                      {onboarding.value.steps.map((step) => (
                        <div className="flex items-center gap-3 py-3" key={step.id}>
                          <span className="flex size-5 shrink-0 items-center justify-center"><StepIcon state={step.state} /></span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium">{step.label}</p>
                            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{step.detail}</p>
                          </div>
                          {step.state !== "action_required" || step.id === nextStep?.id ? null : (
                            <form action="/actions/android" method="post">
                              <input name="action" type="hidden" value={step.action} />
                              <Button size="sm" type="submit">{step.action === "configure_photos" ? "Configure Photos" : "Open Android"}</Button>
                            </form>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          </details>
          </section>
        </div>

          <section aria-labelledby="android-viewer-title" className="space-y-3 md:sticky md:top-6">
            <h2 id="android-viewer-title" className="sr-only">Android</h2>
            <div className="mx-auto w-full max-w-[23rem] overflow-hidden rounded-2xl border border-border/80 bg-black shadow-lg shadow-black/10">
              <iframe className="block aspect-[9/20] w-full bg-black" referrerPolicy="no-referrer" src={config.androidViewerUrl} title="Fairth Android viewer" />
            </div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">Live, interactive Android screen</p>
              <Button render={<a href={config.androidViewerUrl} rel="noreferrer" target="_blank" />} size="sm" variant="ghost">
                Open separately <ExternalLinkIcon data-icon="inline-end" aria-hidden="true" />
              </Button>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">This viewer provides full Android control and must remain limited to your LAN or tailnet.</p>
          </section>
      </div>
    </OwnerShell>
  );
}
