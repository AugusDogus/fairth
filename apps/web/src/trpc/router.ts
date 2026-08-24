import { TRPCError, initTRPC } from "@trpc/server";
import type { AuthService } from "../auth";
import { createAndroidWorkerClient } from "../android-worker-client";
import type { Config } from "../config";

export type WebRpcContext = Readonly<{
  authService: AuthService;
  config: Config;
  headers: Headers;
}>;

const t = initTRPC.context<WebRpcContext>().create();

const ownerProcedure = t.procedure.use(async ({ ctx, next }) => {
  const session = await ctx.authService.auth.api.getSession({ headers: ctx.headers });
  if (session === null) throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in as the Fairth owner to continue." });
  return next();
});

export const webRpcRouter = t.router({
  android: t.router({
    status: ownerProcedure.query(({ ctx }) => createAndroidWorkerClient(ctx.config).status.query()),
    openGoogleAccount: ownerProcedure.mutation(({ ctx }) => createAndroidWorkerClient(ctx.config).openGoogleAccount.mutate()),
    configurePhotos: ownerProcedure.mutation(({ ctx }) => createAndroidWorkerClient(ctx.config).configurePhotos.mutate()),
    reconcileProvisioning: ownerProcedure.mutation(({ ctx }) => createAndroidWorkerClient(ctx.config).reconcileProvisioning.mutate()),
  }),
});

export type WebRpcRouter = typeof webRpcRouter;
