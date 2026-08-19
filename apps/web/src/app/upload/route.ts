import { getUploadApi } from "@/upload-runtime";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return (await getUploadApi()).direct(request);
}
