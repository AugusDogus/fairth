# Networking and TLS

The Fairth container serves HTTP on host ports 3000 and 6080. It works directly
over a trusted LAN, a Tailscale IP, or a MagicDNS name. Set
`PUBLIC_BASE_URL` and `ANDROID_VIEWER_URL` to addresses that the relevant clients
can reach.

TLS belongs at an optional ingress such as Tailscale Serve or Traefik. Fairth
does not need to know which ingress carries a request, except that
`PUBLIC_BASE_URL` must match the canonical origin used for owner authentication
and device enrollment.

The endpoints have different exposure requirements:

| Service | LAN or tailnet | Public Internet |
| --- | --- | --- |
| Web app and upload API, port 3000 | Yes | Optional through authenticated HTTPS |
| Android viewer, port 6080 | Yes | Never |
| Android worker health | Fairth container loopback only | Never |
| ADB | Private Fairth Docker network only | Never |

The Android viewer provides live control of Android and can display Google sign-in.
It is passwordless by default so it can be embedded in the authenticated onboarding
page without a second prompt. Its host port defaults to loopback and must remain
behind a trusted LAN, tailnet policy, or SSH tunnel. `ANDROID_VIEWER_PASSWORD` can
add a VNC prompt when a directly exposed LAN viewer needs defense in depth.

## Trusted LAN

The `.env.example` defaults work on a LAN that resolves `unraid.local`:

```dotenv
PUBLIC_BASE_URL=http://unraid.local:3000
ANDROID_VIEWER_URL=http://unraid.local:6080/vnc.html?autoconnect=1&resize=scale
WEB_BIND_ADDRESS=0.0.0.0
ANDROID_VIEWER_BIND_ADDRESS=0.0.0.0
```

The LAN example explicitly overrides the viewer's loopback default. Do not
port-forward either raw host port. Use a specific LAN address instead of `0.0.0.0`
when Fairth should listen on only one host interface. Consider setting
`ANDROID_VIEWER_PASSWORD` when every trusted LAN client should not receive access.

## Direct Tailscale IP or MagicDNS

Tailscale encrypts device-to-device traffic even when the application URL uses
HTTP. Set the canonical URLs to the Unraid Tailscale IP or a MagicDNS name that
every client can resolve:

```dotenv
PUBLIC_BASE_URL=http://100.100.10.20:3000
ANDROID_VIEWER_URL=http://100.100.10.20:6080/vnc.html?autoconnect=1&resize=scale
WEB_BIND_ADDRESS=100.100.10.20
ANDROID_VIEWER_BIND_ADDRESS=100.100.10.20
```

No alternate image or deployment mode is required.

## Tailscale Serve HTTPS

Tailscale Serve can terminate browser-trusted HTTPS for the Unraid machine's
full `*.ts.net` name and forward to the same base stack.

Set the externally visible URLs and keep the host ports on loopback:

```dotenv
PUBLIC_BASE_URL=https://unraid.example-tailnet.ts.net
ANDROID_VIEWER_URL=https://unraid.example-tailnet.ts.net:8443/vnc.html?autoconnect=1&resize=scale
WEB_BIND_ADDRESS=127.0.0.1
ANDROID_VIEWER_BIND_ADDRESS=127.0.0.1
```

Inspect existing Serve configuration before changing it, then add the two
listeners:

```bash
tailscale serve status
tailscale serve --bg --https=443 http://127.0.0.1:3000
tailscale serve --bg --https=8443 http://127.0.0.1:6080
```

Restrict both ports with the tailnet access policy. `tailscale serve --bg`
persists its configuration across Tailscale restarts.

References: [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve),
[Serve CLI](https://tailscale.com/docs/reference/tailscale-cli/serve), and
[Tailscale HTTPS](https://tailscale.com/docs/how-to/set-up-https-certificates).

## Public web access through Traefik

Traefik requires Docker labels and membership in its external network. The
launcher connects only the Fairth application container when enabled. The
privileged Redroid container remains isolated on `FAIRTH_NETWORK`. Only the web
endpoint is routed. The Android viewer remains on its host port.

Set these values in `.env`:

```dotenv
TRAEFIK_ENABLE=true
FAIRTH_HOSTNAME=fairth.example.com
PUBLIC_BASE_URL=https://fairth.example.com
WEB_BIND_ADDRESS=127.0.0.1
TRAEFIK_NETWORK=traefik
TRAEFIK_ENTRYPOINT=websecure
TRAEFIK_CERT_RESOLVER=letsencrypt
TRAEFIK_RATE_LIMIT_AVERAGE=50
TRAEFIK_RATE_LIMIT_BURST=100
TRAEFIK_MAX_REQUEST_BODY_BYTES=16777216
```

Start Fairth with `bin/fairth-android up` so the launcher adds the network and
labels to the application container. A bare `docker run --env-file .env` does
not turn environment variables into Docker labels.

`TRAEFIK_NETWORK` must already be attached to Traefik, and the certificate
resolver name must match its configuration. Create a Cloudflare DNS record for
`FAIRTH_HOSTNAME` that resolves to Traefik. The record can be DNS-only or
proxied. When Cloudflare proxies it, use Full (strict) TLS. Keep the raw
web host port on loopback so remote traffic cannot bypass Traefik.

Do not create a Traefik router for port 6080. Administrators can reach it
over the LAN, a direct Tailscale address, Tailscale Serve on port 8443, or an SSH
tunnel:

```bash
ssh -N -L 6080:127.0.0.1:6080 root@unraid
```

The public router adds coarse rate limiting and caps each request at 16 MiB by
default. This accommodates the default 8 MiB resumable chunks. Public clients
must use the resumable protocol for larger files instead of the complete-file
`/upload` route. Keep `TRAEFIK_MAX_REQUEST_BODY_BYTES` larger than
`UPLOAD_CHUNK_BYTES`.

Only the Redroid container is privileged. The public Fairth application
container runs without `--privileged` and as a non-root user. Keep Fairth
patched, expose only port 3000 through Traefik, and never route the Android
viewer.

References: [Traefik Docker routing](https://doc.traefik.io/traefik/routing/providers/docker/),
[Traefik TLS](https://doc.traefik.io/traefik/https/tls/), and
[Cloudflare encryption modes](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/).
