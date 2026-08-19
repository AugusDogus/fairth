import { getRuntime } from "../runtime";
import { webRpcRouter } from "./router";

export async function createWebRpcContext(headers: Headers) {
  const { authService, config } = await getRuntime();
  return { authService, config, headers };
}

export async function createWebRpcCaller(headers: Headers) {
  return webRpcRouter.createCaller(await createWebRpcContext(headers));
}
