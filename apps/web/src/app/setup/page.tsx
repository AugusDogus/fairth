import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { OwnerError } from "@/components/owner-error";
import { OwnerShell } from "@/components/owner-shell";

export const dynamic = "force-dynamic";

type SetupPageProps = Readonly<{ searchParams: Promise<{ error?: string; token?: string }> }>;

export default async function SetupPage({ searchParams }: SetupPageProps) {
  const { error, token = "" } = await searchParams;
  const { getRuntime } = await import("@/runtime");
  const { authService } = await getRuntime();
  const expectedUrl = authService.ownerSetupUrl();
  if (expectedUrl === undefined) redirect("/login");
  const validToken = new URL(expectedUrl).searchParams.get("token") === token;

  return (
    <OwnerShell
      eyebrow="One-time setup"
      title="Create the appliance owner"
      description="This account approves companion phones and revokes their upload sessions. It is separate from the Google account inside Android."
    >
      <div className="space-y-5">
        <OwnerError message={validToken ? error : "Use the current owner setup link printed by the ingestion service."} />
        {validToken ? (
          <form action="/actions/setup" method="post">
            <input name="token" type="hidden" value={token} />
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="name">Name</FieldLabel>
                <Input autoComplete="name" id="name" name="name" required />
              </Field>
              <Field>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input autoComplete="username" id="email" name="email" required type="email" />
              </Field>
              <Field>
                <FieldLabel htmlFor="password">Password</FieldLabel>
                <Input autoComplete="new-password" id="password" maxLength={128} minLength={12} name="password" required type="password" />
                <FieldDescription>Use at least 12 characters.</FieldDescription>
              </Field>
              <Button size="lg" type="submit">Create owner</Button>
            </FieldGroup>
          </form>
        ) : null}
      </div>
    </OwnerShell>
  );
}
