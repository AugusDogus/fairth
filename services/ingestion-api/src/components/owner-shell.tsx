import type { ReactNode } from "react";
import { CloudUploadIcon, ShieldCheckIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type OwnerShellProps = Readonly<{
  children: ReactNode;
  description: string;
  eyebrow?: string;
  title: string;
}>;

export function OwnerShell({ children, description, eyebrow = "Fairth appliance", title }: OwnerShellProps) {
  return (
    <main className="relative flex min-h-svh items-center justify-center overflow-hidden bg-background px-4 py-10 text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,oklch(0.78_0.12_181_/_0.16),transparent_38%),radial-gradient(circle_at_bottom_right,oklch(0.62_0.12_181_/_0.10),transparent_34%)]" />
      <div className="relative w-full max-w-lg space-y-5">
        <div className="flex items-center justify-between px-1">
          <a className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight" href="/owner/devices">
            <span className="flex size-8 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <CloudUploadIcon className="size-4" aria-hidden="true" />
            </span>
            Fairth
          </a>
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheckIcon className="size-3.5" aria-hidden="true" />
            Private appliance
          </span>
        </div>
        <Card className="border-border/70 shadow-xl shadow-primary/5">
          <CardHeader className="gap-2">
            <p className="text-xs font-semibold tracking-[0.16em] text-primary uppercase">{eyebrow}</p>
            <CardTitle className="text-2xl">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
          <CardContent>{children}</CardContent>
        </Card>
      </div>
    </main>
  );
}
