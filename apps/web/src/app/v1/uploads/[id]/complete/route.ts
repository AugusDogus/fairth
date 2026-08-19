import { getUploadApi } from "@/upload-runtime";

export const runtime = "nodejs";

type RouteContext = Readonly<{ params: Promise<{ id: string }> }>;

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  return (await getUploadApi()).completeSession(request, id);
}
