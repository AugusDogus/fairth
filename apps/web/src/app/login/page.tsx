import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { OwnerError } from "@/components/owner-error";
import { OwnerShell } from "@/components/owner-shell";
import { safeNext } from "@/owner-http";

type LoginPageProps = Readonly<{ searchParams: Promise<{ error?: string; next?: string }> }>;

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { error, next: requestedNext = "/devices" } = await searchParams;
  const { getRuntime } = await import("@/runtime");
  const next = safeNext(requestedNext);
  const { authService } = await getRuntime();
  const session = await authService.auth.api.getSession({ headers: new Headers(await headers()) });
  if (session !== null) redirect(next);

  return (
    <OwnerShell title="Sign in to Fairth" description="Approve companion devices and manage the sessions allowed to upload media.">
      <div className="space-y-5">
        <OwnerError message={error} />
        <form action="/actions/login" method="post">
          <input name="next" type="hidden" value={next} />
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="email">Email</FieldLabel>
              <Input autoComplete="username" id="email" name="email" required type="email" />
            </Field>
            <Field>
              <FieldLabel htmlFor="password">Password</FieldLabel>
              <Input autoComplete="current-password" id="password" name="password" required type="password" />
            </Field>
            <Button size="lg" type="submit">Sign in</Button>
          </FieldGroup>
        </form>
      </div>
    </OwnerShell>
  );
}
