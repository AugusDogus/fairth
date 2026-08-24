import type { ReactNode } from "react";
import { CloudUploadIcon, ShieldCheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type OwnerShellProps = Readonly<{
  children: ReactNode;
  description: string;
  heading?: "hidden" | "visible";
  title: string;
  width?: "default" | "wide";
}>;

export function OwnerShell({ children, description, heading = "visible", title, width = "default" }: OwnerShellProps) {
  return (
    <main className="min-h-svh bg-background px-5 py-6 text-foreground sm:px-8 sm:py-8">
      <div className={cn("mx-auto w-full", width === "wide" ? "max-w-5xl" : "max-w-lg")}>
        <nav className="flex items-center justify-between gap-4 border-b border-border/70 pb-5" aria-label="Owner navigation">
          <a className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight" href="/devices">
            <span className="flex size-8 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <CloudUploadIcon className="size-4" aria-hidden="true" />
            </span>
            Fairth
          </a>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <a className="hover:text-foreground" href="/onboarding">Setup</a>
            <a className="hover:text-foreground" href="/devices">Devices</a>
            <span className="hidden items-center gap-1.5 sm:inline-flex">
              <ShieldCheckIcon className="size-3.5" aria-hidden="true" />
              Private appliance
            </span>
          </div>
        </nav>
        {heading === "hidden" ? null : (
          <header className="py-7 sm:py-9">
            <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
          </header>
        )}
        {children}
      </div>
    </main>
  );
}
