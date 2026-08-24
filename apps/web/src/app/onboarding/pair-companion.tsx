"use client";

import { useCallback, useEffect, useState } from "react";
import { QrCodeIcon, RefreshCwIcon } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";

type PairingState =
  | Readonly<{ kind: "loading" }>
  | Readonly<{ kind: "ready"; expiresAt: number; pairingUri: string }>
  | Readonly<{ kind: "error"; message: string }>;

function pairingResponse(value: unknown): PairingState {
  if (typeof value !== "object" || value === null) {
    return { kind: "error", message: "Fairth returned an invalid pairing response. Create a new QR code." };
  }
  const record = Object.fromEntries(Object.entries(value));
  if (typeof record.pairingUri === "string" && typeof record.expiresAt === "number") {
    return { kind: "ready", expiresAt: record.expiresAt, pairingUri: record.pairingUri };
  }
  const message = typeof record.message === "string"
    ? record.message
    : "Fairth could not create a QR code. Try again.";
  return { kind: "error", message };
}

export function PairCompanion() {
  const [state, setState] = useState<PairingState>({ kind: "loading" });

  const createPairing = useCallback(async (): Promise<void> => {
    setState({ kind: "loading" });
    try {
      const response = await fetch("/api/pairing", { method: "POST" });
      setState(pairingResponse(await response.json()));
    } catch {
      setState({ kind: "error", message: "Fairth could not create a QR code. Check the connection and try again." });
    }
  }, []);

  useEffect(() => {
    void createPairing();
  }, [createPairing]);

  useEffect(() => {
    if (state.kind !== "ready") return undefined;
    const remaining = Math.max(0, state.expiresAt - Date.now());
    const timeout = setTimeout(() => {
      setState({ kind: "error", message: "This QR code expired. Create a new one to continue." });
    }, remaining);
    return () => clearTimeout(timeout);
  }, [state]);

  return (
    <div aria-labelledby="pair-phone-title">
      <div className="grid items-center gap-6 sm:grid-cols-[minmax(0,1fr)_15rem]">
        <div>
          <h2 className="text-xl font-semibold tracking-tight" id="pair-phone-title">Pair your phone</h2>
          <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
            Open Fairth Companion, tap <span className="font-medium text-foreground">Scan QR code</span>, then point the camera here.
          </p>
          <p className="mt-4 text-xs leading-5 text-muted-foreground">
            Can’t scan? Use <span className="font-medium text-foreground">Approve in browser instead</span> in the companion app.
          </p>
        </div>

        <div className="flex min-h-60 items-center justify-center bg-white p-3 text-slate-950 ring-1 ring-slate-200">
          {state.kind === "loading" ? (
            <div className="flex flex-col items-center gap-3 text-slate-500" role="status">
              <RefreshCwIcon className="size-6 animate-spin" aria-hidden="true" />
              <span className="text-xs">Creating QR code</span>
            </div>
          ) : state.kind === "error" ? (
            <div className="flex max-w-48 flex-col items-center gap-4 text-center">
              <QrCodeIcon className="size-8 text-slate-400" aria-hidden="true" />
              <p className="text-xs leading-5 text-slate-600">{state.message}</p>
              <Button onClick={() => void createPairing()} size="sm" type="button">Create new code</Button>
            </div>
          ) : (
            <div className="text-center">
              <QRCodeSVG
                aria-label="Fairth companion pairing QR code"
                bgColor="#FFFFFF"
                fgColor="#101828"
                level="M"
                marginSize={2}
                size={208}
                value={state.pairingUri}
              />
              <p className="mt-2 text-[11px] text-slate-500">One use, expires in 30 minutes</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
