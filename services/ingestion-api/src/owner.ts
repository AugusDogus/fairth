import { Hono } from "hono";
import type { AuthService } from "./auth.js";
import type { Config } from "./config.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function page(title: string, content: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} · Fairth</title>
<style>body{background:#07111f;color:#e2e8f0;font:16px system-ui;margin:0}.card{background:#0f1d2e;border:1px solid #1e3349;border-radius:18px;margin:8vh auto;max-width:34rem;padding:2rem}h1{color:#f8fafc}label{display:block;font-size:.85rem;margin-top:1rem}input{background:#07111f;border:1px solid #334155;border-radius:10px;box-sizing:border-box;color:#f8fafc;font:inherit;margin-top:.4rem;padding:.8rem;width:100%}button,.button{background:#2dd4bf;border:0;border-radius:10px;color:#042f2e;cursor:pointer;display:inline-block;font-weight:800;margin-top:1.25rem;padding:.8rem 1rem;text-decoration:none}.muted{color:#94a3b8}.error{color:#fca5a5}.session{border-top:1px solid #334155;margin-top:1rem;padding-top:1rem}.code{font:800 2rem ui-monospace;letter-spacing:.2rem}</style>
</head><body><main class="card">${content}</main></body></html>`;
}

function stringField(body: Readonly<Record<string, unknown>>, name: string): string {
  const value = body[name];
  return typeof value === "string" ? value : "";
}

function safeNext(value: string): string {
  return value.startsWith("/") && !value.startsWith("//") ? value : "/owner/devices";
}

function sameOrigin(request: Request, config: Config): boolean {
  const expected = new URL(config.publicBaseUrl).origin;
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== "null") return origin === expected;
  return new URL(request.url).origin === expected;
}

function redirectWithHeaders(location: string, source: Headers): Response {
  const headers = new Headers(source);
  headers.set("location", location);
  return new Response(null, { status: 303, headers });
}

export function createOwnerApp(config: Config, service: AuthService) {
  const app = new Hono();

  app.use("*", async (context, next) => {
    await next();
    context.header("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
    context.header("referrer-policy", "no-referrer");
  });

  app.get("/owner/setup", (context) => {
    const expectedUrl = service.ownerSetupUrl();
    const token = context.req.query("token") ?? "";
    if (expectedUrl === undefined) return context.redirect("/owner/login", 303);
    if (new URL(expectedUrl).searchParams.get("token") !== token) {
      return context.html(page("Invalid setup link", '<h1>Invalid setup link</h1><p class="error">Use the current owner setup link printed by the ingestion API.</p>'), 403);
    }
    return context.html(page("Create owner", `<h1>Create the Fairth owner</h1><p class="muted">This one-time account approves companion devices and revokes their sessions.</p>
<form method="post" action="/owner/setup"><input type="hidden" name="token" value="${escapeHtml(token)}">
<label>Name<input name="name" autocomplete="name" required></label>
<label>Email<input name="email" type="email" autocomplete="username" required></label>
<label>Password<input name="password" type="password" minlength="12" maxlength="128" autocomplete="new-password" required></label>
<button type="submit">Create owner</button></form>`));
  });

  app.post("/owner/setup", async (context) => {
    if (!sameOrigin(context.req.raw, config)) return context.json({ error: "invalid_origin", message: "Reload the owner setup page and submit it from the configured Fairth origin." }, 403);
    const body = await context.req.parseBody();
    const result = await service.createOwner({
      token: stringField(body, "token"),
      name: stringField(body, "name"),
      email: stringField(body, "email"),
      password: stringField(body, "password"),
    });
    if (!result.ok) return context.html(page("Owner setup failed", `<h1>Owner setup failed</h1><p class="error">${escapeHtml(result.message)}</p>`), result.code === "invalid_token" ? 403 : 409);
    return redirectWithHeaders("/owner/devices", result.headers);
  });

  app.get("/owner/login", async (context) => {
    const session = await service.auth.api.getSession({ headers: context.req.raw.headers });
    const next = safeNext(context.req.query("next") ?? "/owner/devices");
    if (session !== null) return context.redirect(next, 303);
    return context.html(page("Owner sign in", `<h1>Owner sign in</h1><p class="muted">Sign in to approve or revoke companion devices.</p>
<form method="post" action="/owner/login"><input type="hidden" name="next" value="${escapeHtml(next)}">
<label>Email<input name="email" type="email" autocomplete="username" required></label>
<label>Password<input name="password" type="password" autocomplete="current-password" required></label>
<button type="submit">Sign in</button></form>`));
  });

  app.post("/owner/login", async (context) => {
    if (!sameOrigin(context.req.raw, config)) return context.json({ error: "invalid_origin", message: "Reload the owner sign-in page and submit it from the configured Fairth origin." }, 403);
    const body = await context.req.parseBody();
    const next = safeNext(stringField(body, "next"));
    try {
      const result = await service.auth.api.signInEmail({
        body: { email: stringField(body, "email"), password: stringField(body, "password") },
        headers: context.req.raw.headers,
        returnHeaders: true,
      });
      return redirectWithHeaders(next, result.headers);
    } catch {
      return context.html(page("Sign in failed", '<h1>Sign in failed</h1><p class="error">The email or password was not accepted.</p><a class="button" href="/owner/login">Try again</a>'), 401);
    }
  });

  app.get("/device", async (context) => {
    const userCode = context.req.query("user_code") ?? "";
    const returnPath = `/device?user_code=${encodeURIComponent(userCode)}`;
    const session = await service.auth.api.getSession({ headers: context.req.raw.headers });
    if (session === null) return context.redirect(`/owner/login?next=${encodeURIComponent(returnPath)}`, 303);
    if (userCode.length === 0) {
      return context.html(page("Approve device", '<h1>Approve a device</h1><form method="get"><label>Code<input name="user_code" autocomplete="one-time-code" required></label><button type="submit">Continue</button></form>'));
    }
    try {
      const request = await service.auth.api.deviceVerify({ query: { user_code: userCode }, headers: context.req.raw.headers });
      return context.html(page("Approve device", `<h1>Approve companion</h1><p class="muted">A Fairth companion is requesting upload access.</p><p class="code">${escapeHtml(userCode)}</p>
<p>Client: ${escapeHtml(request.client_id ?? "unknown")}</p>
<form method="post" action="/owner/device/approve"><input type="hidden" name="userCode" value="${escapeHtml(userCode)}"><button type="submit">Approve device</button></form>`));
    } catch {
      return context.html(page("Invalid device code", '<h1>Invalid device code</h1><p class="error">This code is invalid, expired, or has already been used.</p>'), 400);
    }
  });

  app.post("/owner/device/approve", async (context) => {
    if (!sameOrigin(context.req.raw, config)) return context.json({ error: "invalid_origin", message: "Reload the approval page and submit it from the configured Fairth origin." }, 403);
    const body = await context.req.parseBody();
    const userCode = stringField(body, "userCode");
    await service.auth.api.deviceApprove({ body: { userCode }, headers: context.req.raw.headers });
    return context.html(page("Device approved", '<h1>Device approved</h1><p>The companion can now finish enrollment.</p><a class="button" href="fairth://enrolled">Return to companion</a> <a class="button" href="/owner/devices">Manage devices</a>'));
  });

  app.get("/owner/devices", async (context) => {
    const current = await service.auth.api.getSession({ headers: context.req.raw.headers });
    if (current === null) return context.redirect(`/owner/login?next=${encodeURIComponent("/owner/devices")}`, 303);
    const sessions = await service.auth.api.listSessions({ headers: context.req.raw.headers });
    const rendered = sessions.map((session) => `<section class="session"><strong>${escapeHtml(session.userAgent ?? "Unknown device")}</strong><p class="muted">Created ${escapeHtml(new Date(session.createdAt).toLocaleString())}, expires ${escapeHtml(new Date(session.expiresAt).toLocaleString())}</p>${session.token === current.session.token ? "<p>Current owner browser</p>" : `<form method="post" action="/owner/sessions/revoke"><input type="hidden" name="token" value="${escapeHtml(session.token)}"><button type="submit">Revoke</button></form>`}</section>`).join("");
    return context.html(page("Devices", `<h1>Authorized devices</h1><p class="muted">Revoking a session stops that companion's future uploads.</p>${rendered || "<p>No sessions found.</p>"}`));
  });

  app.post("/owner/sessions/revoke", async (context) => {
    if (!sameOrigin(context.req.raw, config)) return context.json({ error: "invalid_origin", message: "Reload the devices page and submit it from the configured Fairth origin." }, 403);
    const body = await context.req.parseBody();
    await service.auth.api.revokeSession({ body: { token: stringField(body, "token") }, headers: context.req.raw.headers });
    return context.redirect("/owner/devices", 303);
  });

  return app;
}
