export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { getRuntime } = await import("./runtime");
  const { authService, config } = await getRuntime();
  console.log(JSON.stringify({ level: "info", event: "runtime_ready", publicBaseUrl: config.publicBaseUrl }));
  const ownerSetupUrl = authService.ownerSetupUrl();
  if (ownerSetupUrl !== undefined) {
    console.log(JSON.stringify({ level: "info", event: "owner_setup_required", url: ownerSetupUrl }));
  }
}
