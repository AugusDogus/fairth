import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { SmartphoneIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { OwnerError } from "@/components/owner-error";
import { OwnerShell } from "@/components/owner-shell";

type DevicePageProps = Readonly<{ searchParams: Promise<{ error?: string; user_code?: string }> }>;

export default async function DevicePage({ searchParams }: DevicePageProps) {
  const { error, user_code: userCode = "" } = await searchParams;
  const { getRuntime } = await import("@/runtime");
  const requestHeaders = new Headers(await headers());
  const { authService } = await getRuntime();
  const session = await authService.auth.api.getSession({ headers: requestHeaders });
  const returnPath = `/device?user_code=${encodeURIComponent(userCode)}`;
  if (session === null) redirect(`/login?next=${encodeURIComponent(returnPath)}`);

  if (userCode.length === 0) {
    return (
      <OwnerShell eyebrow="Companion enrollment" title="Enter the device code" description="Type the eight-character code shown by the Fairth companion app.">
        <form method="get">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="user_code">Device code</FieldLabel>
              <Input autoComplete="one-time-code" className="font-mono uppercase tracking-[0.18em]" id="user_code" name="user_code" required />
            </Field>
            <Button size="lg" type="submit">Continue</Button>
          </FieldGroup>
        </form>
      </OwnerShell>
    );
  }

  let clientId: string | undefined;
  let verificationError = error;
  try {
    const deviceRequest = await authService.auth.api.deviceVerify({ query: { user_code: userCode }, headers: requestHeaders });
    clientId = deviceRequest.client_id ?? undefined;
  } catch {
    verificationError = "This code is invalid, expired, or has already been used.";
  }

  return (
    <OwnerShell eyebrow="Companion enrollment" title="Approve this device?" description="Approval creates a revocable session that can upload media, but cannot manage the appliance.">
      <div className="space-y-5">
        <OwnerError message={verificationError} />
        {clientId === undefined ? null : (
          <>
            <div className="flex items-center gap-3 rounded-xl border bg-muted/40 p-4">
              <SmartphoneIcon className="size-5 text-primary" aria-hidden="true" />
              <div>
                <p className="font-mono text-lg font-semibold tracking-[0.16em]">{userCode}</p>
                <p className="text-xs text-muted-foreground">Client: {clientId}</p>
              </div>
            </div>
            <form action="/actions/approve" method="post">
              <input name="userCode" type="hidden" value={userCode} />
              <Button className="w-full" size="lg" type="submit">Approve device</Button>
            </form>
          </>
        )}
      </div>
    </OwnerShell>
  );
}
