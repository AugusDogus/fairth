import { CheckCircle2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OwnerShell } from "@/components/owner-shell";

export default function DeviceApprovedPage() {
  return (
    <OwnerShell title="Device approved" description="The companion can now finish enrollment and begin its background upload schedule.">
      <div className="space-y-5">
        <div className="flex items-center gap-3 rounded-xl border bg-muted/40 p-4">
          <CheckCircle2Icon className="size-5 text-primary" aria-hidden="true" />
          <p className="text-sm">This upload session remains revocable from the authorized devices page.</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Button render={<a href="fairth://enrolled" />} size="lg">Return to companion</Button>
          <Button render={<a href="/devices" />} size="lg" variant="outline">Manage devices</Button>
        </div>
      </div>
    </OwnerShell>
  );
}
