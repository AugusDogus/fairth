import { initTRPC } from "@trpc/server";
import { z } from "zod";

export const AndroidActionSchema = z.enum(["open_google_account", "open_photos"]);
export type AndroidAction = z.infer<typeof AndroidActionSchema>;

const stepBase = z.object({
  id: z.enum(["android", "gapps", "magisk", "lsposed", "pixelmask", "google_account", "photos"]),
  label: z.string(),
  detail: z.string(),
});

export const AndroidStepSchema = z.discriminatedUnion("state", [
  stepBase.extend({ state: z.literal("complete") }),
  stepBase.extend({ state: z.literal("blocked") }),
  stepBase.extend({ state: z.literal("action_required"), action: AndroidActionSchema }),
]);
export type AndroidStep = z.infer<typeof AndroidStepSchema>;

export const AndroidOnboardingSchema = z.object({
  automaticReady: z.boolean(),
  googleAccountReady: z.boolean(),
  steps: z.array(AndroidStepSchema),
});
export type AndroidOnboarding = z.infer<typeof AndroidOnboardingSchema>;

export const AndroidOperationResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), message: z.string() }),
]);
export type AndroidOperationResult = z.infer<typeof AndroidOperationResultSchema>;

export type AndroidController = Readonly<{
  onboarding: () => Promise<AndroidOnboarding>;
  openGoogleAccount: () => Promise<AndroidOperationResult>;
  openPhotos: () => Promise<AndroidOperationResult>;
  reconcileProvisioning: () => Promise<AndroidOperationResult>;
}>;

export type AndroidRpcContext = Readonly<{ android: AndroidController }>;

const t = initTRPC.context<AndroidRpcContext>().create();

export const androidRpcRouter = t.router({
  status: t.procedure.output(AndroidOnboardingSchema).query(({ ctx }) => ctx.android.onboarding()),
  openGoogleAccount: t.procedure.output(AndroidOperationResultSchema).mutation(({ ctx }) => ctx.android.openGoogleAccount()),
  openPhotos: t.procedure.output(AndroidOperationResultSchema).mutation(({ ctx }) => ctx.android.openPhotos()),
  reconcileProvisioning: t.procedure.output(AndroidOperationResultSchema).mutation(({ ctx }) => ctx.android.reconcileProvisioning()),
});

export type AndroidRpcRouter = typeof androidRpcRouter;
