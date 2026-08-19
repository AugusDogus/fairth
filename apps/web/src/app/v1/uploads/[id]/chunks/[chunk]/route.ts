import { getUploadApi } from "@/upload-runtime";

export const runtime = "nodejs";

type RouteContext = Readonly<{ params: Promise<{ id: string; chunk: string }> }>;

export async function PUT(request: Request, context: RouteContext): Promise<Response> {
  const { id, chunk } = await context.params;
  return (await getUploadApi()).putChunk(request, id, chunk);
}
