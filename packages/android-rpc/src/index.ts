import { initTRPC } from "@trpc/server";
import { z } from "zod";

export const AndroidActionSchema = z.enum(["open_google_account", "configure_photos"]);
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

export const GooglePhotosProgressSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("needs_setup"), detail: z.string() }),
  z.object({ state: z.literal("idle"), detail: z.string() }),
  z.object({
    state: z.literal("uploading"),
    detail: z.string(),
    completed: z.number().int().nonnegative().optional(),
    total: z.number().int().nonnegative().optional(),
    remaining: z.number().int().nonnegative().optional(),
  }),
  z.object({ state: z.literal("blocked"), detail: z.string() }),
]);
export type GooglePhotosProgress = z.infer<typeof GooglePhotosProgressSchema>;

export const ImportProgressSchema = z.object({
  pending: z.number().int().nonnegative(),
  imported: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  duplicate: z.number().int().nonnegative(),
});
export type ImportProgress = z.infer<typeof ImportProgressSchema>;

export const AndroidPipelineProgressSchema = z.object({
  imports: ImportProgressSchema,
  googlePhotos: GooglePhotosProgressSchema,
});
export type AndroidPipelineProgress = z.infer<typeof AndroidPipelineProgressSchema>;

export type AndroidController = Readonly<{
  onboarding: () => Promise<AndroidOnboarding>;
  openGoogleAccount: () => Promise<AndroidOperationResult>;
  configurePhotos: () => Promise<AndroidOperationResult>;
  reconcileProvisioning: () => Promise<AndroidOperationResult>;
  progress: () => Promise<AndroidPipelineProgress>;
}>;

export type AndroidRpcContext = Readonly<{ android: AndroidController }>;

const t = initTRPC.context<AndroidRpcContext>().create();

export const androidRpcRouter = t.router({
  status: t.procedure.output(AndroidOnboardingSchema).query(({ ctx }) => ctx.android.onboarding()),
  openGoogleAccount: t.procedure.output(AndroidOperationResultSchema).mutation(({ ctx }) => ctx.android.openGoogleAccount()),
  configurePhotos: t.procedure.output(AndroidOperationResultSchema).mutation(({ ctx }) => ctx.android.configurePhotos()),
  reconcileProvisioning: t.procedure.output(AndroidOperationResultSchema).mutation(({ ctx }) => ctx.android.reconcileProvisioning()),
  progress: t.procedure.output(AndroidPipelineProgressSchema).query(({ ctx }) => ctx.android.progress()),
});

export type AndroidRpcRouter = typeof androidRpcRouter;
