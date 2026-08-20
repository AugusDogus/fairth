import type { Config } from "./config";

export function formString(body: FormData, name: string): string {
  const value = body.get(name);
  return typeof value === "string" ? value : "";
}

export function safeNext(value: string): string {
  return value.startsWith("/") && !value.startsWith("//") ? value : "/devices";
}

function firstHeaderValue(value: string | null): string | undefined {
  const first = value?.split(",", 1)[0]?.trim();
  return first === "" ? undefined : first;
}

function forwardedOrigin(request: Request): string | undefined {
  const protocol = firstHeaderValue(request.headers.get("x-forwarded-proto"));
  const host = firstHeaderValue(request.headers.get("x-forwarded-host"))
    ?? firstHeaderValue(request.headers.get("host"));
  if ((protocol !== "http" && protocol !== "https") || host === undefined) return undefined;
  try {
    return new URL(`${protocol}://${host}`).origin;
  } catch {
    return undefined;
  }
}

export function sameOrigin(request: Request, config: Config): boolean {
  const expected = new URL(config.publicBaseUrl).origin;
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== "null") return origin === expected;
  return forwardedOrigin(request) === expected || new URL(request.url).origin === expected;
}

export function redirectWithHeaders(location: string, source?: Headers): Response {
  const headers = new Headers(source);
  headers.set("location", location);
  return new Response(null, { status: 303, headers });
}

export function redirectWithError(path: string, message: string): Response {
  const separator = path.includes("?") ? "&" : "?";
  return redirectWithHeaders(`${path}${separator}error=${encodeURIComponent(message)}`);
}
