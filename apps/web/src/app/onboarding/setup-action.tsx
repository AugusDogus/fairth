"use client";

import type { AndroidAction } from "@fairth/android-rpc";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

type SetupActionProps = Readonly<{
  action: AndroidAction;
  autoConfigure: boolean;
}>;

function actionLabel(action: AndroidAction, submitted: boolean): string {
  if (action === "open_google_account") return "Open Android";
  return submitted ? "Opening Google Photos…" : "Configure Photos";
}

export function SetupAction({ action, autoConfigure }: SetupActionProps) {
  const form = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (action === "configure_photos") return undefined;
    const interval = setInterval(() => router.refresh(), 2_500);
    return () => clearInterval(interval);
  }, [action, router]);

  useEffect(() => {
    if (action !== "configure_photos" || !autoConfigure || submitted) return;
    setSubmitted(true);
    form.current?.requestSubmit();
  }, [action, autoConfigure, submitted]);

  return (
    <form action="/actions/android" className="mt-3" method="post" onSubmit={() => setSubmitted(true)} ref={form}>
      <input name="action" type="hidden" value={action} />
      <Button disabled={submitted} type="submit">{actionLabel(action, submitted)}</Button>
    </form>
  );
}
