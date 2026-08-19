import { getUploadApi } from "@/upload-runtime";

export const runtime = "nodejs";

type RouteContext = Readonly<{ params: Promise<{ id: string }> }>;

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  return (await getUploadApi()).getSession(request, id);
}
