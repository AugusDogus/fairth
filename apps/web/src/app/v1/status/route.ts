import { getUploadApi } from "@/upload-runtime";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return (await getUploadApi()).status(request);
}
