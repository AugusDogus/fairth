import type { AndroidRpcRouter } from "@fairth/android-rpc";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { Config } from "./config";

export function createAndroidWorkerClient(config: Config) {
  return createTRPCClient<AndroidRpcRouter>({
    links: [httpBatchLink({ url: `${config.androidWorkerUrl}/trpc` })],
  });
}
