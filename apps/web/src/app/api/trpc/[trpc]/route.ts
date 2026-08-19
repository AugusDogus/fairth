import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { createWebRpcContext } from "@/trpc/context";
import { webRpcRouter } from "@/trpc/router";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function handle(request: Request): Promise<Response> {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: request,
    router: webRpcRouter,
    createContext: () => createWebRpcContext(request.headers),
    onError: ({ error, path }) => {
      console.error(JSON.stringify({ level: "error", event: "web_rpc_failed", procedure: path, message: error.message }));
    },
  });
}

export { handle as GET, handle as POST };
