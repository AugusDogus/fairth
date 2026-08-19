import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { MonitorSmartphoneIcon, ShieldCheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { OwnerError } from "@/components/owner-error";
import { OwnerShell } from "@/components/owner-shell";

type DevicesPageProps = Readonly<{ searchParams: Promise<{ error?: string }> }>;

export default async function DevicesPage({ searchParams }: DevicesPageProps) {
  const { error } = await searchParams;
  const { getRuntime } = await import("@/runtime");
  const requestHeaders = new Headers(await headers());
  const { authService } = await getRuntime();
  const current = await authService.auth.api.getSession({ headers: requestHeaders });
  if (current === null) redirect(`/owner/login?next=${encodeURIComponent("/owner/devices")}`);
  const sessions = await authService.auth.api.listSessions({ headers: requestHeaders });

  return (
    <OwnerShell eyebrow="Access control" title="Authorized devices" description="Revoking a session immediately stops that companion from starting or resuming uploads.">
      <div className="space-y-4">
        <OwnerError message={error} />
        <div className="space-y-2">
          {sessions.map((session) => {
            const isCurrent = session.token === current.session.token;
            return (
              <Item key={session.token} variant="outline">
                <ItemMedia variant="icon">
                  {isCurrent ? <ShieldCheckIcon aria-hidden="true" /> : <MonitorSmartphoneIcon aria-hidden="true" />}
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{session.userAgent ?? "Unknown device"}</ItemTitle>
                  <ItemDescription>
                    Created {new Date(session.createdAt).toLocaleString()}, expires {new Date(session.expiresAt).toLocaleString()}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  {isCurrent ? (
                    <span className="text-xs font-medium text-muted-foreground">Current browser</span>
                  ) : (
                    <form action="/owner/actions/revoke" method="post">
                      <input name="token" type="hidden" value={session.token} />
                      <Button size="sm" type="submit" variant="destructive">Revoke</Button>
                    </form>
                  )}
                </ItemActions>
              </Item>
            );
          })}
        </div>
        {sessions.length === 0 ? <p className="text-sm text-muted-foreground">No sessions found.</p> : null}
      </div>
    </OwnerShell>
  );
}
