# Fairth photo bridge

Fairth is a self-hosted photo ingestion appliance. An Expo companion app queues media from a phone, uploads it over HTTP in resumable chunks, and a Docker importer places each completed file in Android MediaStore. The official Google Photos Android app remains the only component that uploads to Google Photos.

```text
Expo companion
      │ authenticated, resumable HTTP
      ▼
ingestion-api ── /incoming/ready
                       │ stable file + SHA-256 dedupe
                       ▼
                    importer
                       │ private ADB push + MediaStore scan
                       ▼
Redroid / DCIM/Incoming / Google Photos
```

## What is included

- Redroid with persistent `/data` and host-only ADB exposure
- Bearer-authenticated direct upload endpoint
- Chunked, resumable upload sessions for large videos
- Atomic publication, so the importer never sees a partial API upload
- Stabilization checks for files copied directly into an Unraid share
- SQLite import history, SHA-256 deduplication, bounded exponential retries, and an archive
- MediaStore verification after every ADB import
- Health details for Android boot, ADB, Google Photos, queue state, and importer state
- Expo SDK 57 app with MediaLibrary discovery, album filters, manual selection, SQLite queueing, LAN-first routing, secure token storage, and background scheduling
- Browser-based Android onboarding over TLS
- Automatic APK, Magisk module, LSPosed, and PixelMask artifact provisioning

## Important runtime facts

Redroid needs Android Binder support from the host kernel. It does not use `/dev/kvm`. On Unraid, confirm that `/dev/binder` or a compatible Binder setup exists before deploying.

The stock `redroid/redroid` image is AOSP. It does not include Google Mobile Services, Google Photos, Magisk, or ARM translation. Fairth therefore requires `REDROID_IMAGE` to name an image you built or obtained under licenses that permit those packages. The included builder uses Android 11 because its x86-64 GApps and ARM native-bridge path is the combination its upstream builder documents as working.

PixelMask does not replace Magisk or Zygisk. It is an LSPosed module, and LSPosed requires Magisk/Zygisk or an equivalent root framework. PixelMask currently publishes an `arm64-v8a` application. An x86-64 Unraid host therefore needs a Redroid image with a working ARM native bridge as well as GApps and Magisk. `bin/fairth-android build-image` uses a pinned revision of the community `redroid-script` project to build that image locally. Review that third-party input and the applicable package licenses before running it. Fairth does not commit or redistribute the resulting proprietary packages.

References: [Redroid documentation](https://github.com/remote-android/redroid-doc), [Redroid GMS build notes](https://github.com/remote-android/redroid-doc/tree/master/android-builder-docker), [LSPosed installation](https://github.com/LSPosed/LSPosed/wiki/How-to-use-it), and [PixelMask instructions](https://github.com/Xposed-Modules-Repo/com.kinginu.pixelmask).

## Unraid setup

The host needs rootful Docker, the Docker Compose plugin (commonly installed through Unraid's Compose Manager), Android Binder support, `git`, Python 3 with `venv`, and `lzip`. Redroid will not boot in rootless Podman even when the kernel registers Binder.

Create persistent directories outside `docker.img`:

```bash
mkdir -p /mnt/user/appdata/fairth/android-data
mkdir -p /mnt/user/appdata/fairth/importer
mkdir -p /mnt/user/appdata/fairth/setup
mkdir -p /mnt/user/photos-incoming/{drop,ready,archive}
chown -R 99:100 /mnt/user/appdata/fairth/importer /mnt/user/photos-incoming
```

Copy the environment template and generate an ingestion token:

```bash
cp .env.example .env
openssl rand -hex 32
```

Put the generated value in `INGESTION_TOKEN`. Generate the eight-character `SETUP_PASSWORD` as shown in `.env.example`. Set `REDROID_IMAGE` to a GApps + Magisk + native-bridge image when using PixelMask on x86-64.

Build the default local Android image once. This downloads the official Redroid base and pinned third-party GApps, Magisk, and native-bridge inputs:

```bash
bin/fairth-android build-image
```

Validate and start the appliance:

```bash
bin/fairth-android check
bin/fairth-android up
```

`up` waits for Android and prints an HTTPS onboarding link. Open it, accept the appliance's private certificate, and enter `SETUP_PASSWORD`. The page is a live view of the Android phone. Complete Google's sign-in in that view, then enable backup in Google Photos. Run `bin/fairth-android onboard` to print the link again.

Google does not provide a supported way for a separate web OAuth callback to inject an account into Android's system account store. The browser view keeps credential entry in Google's Android UI. Fairth never receives or stores the Google password. The persistent Android `/data` mount preserves the resulting account across container restarts.

ADB is bound only to `127.0.0.1`. The importer reaches it through a private Docker network that also gives Android outbound access to Google services. The ingestion API and TLS-protected setup page are LAN-facing. Keep the setup page on a trusted LAN or VPN because it provides full control of Android.

## Automated Android provisioning

Place user-supplied files as described in [`artifacts/README.md`](artifacts/README.md):

```text
artifacts/apks/*.apk       Google Photos, PixelMask, and other required APKs
artifacts/modules/*.zip    LSPosed Zygisk module
```

The setup service hashes these files, installs changed APKs, enables Zygisk, installs changed modules, and reboots Android when needed. Applied artifact state persists, so ordinary restarts do not reinstall it. `bin/fairth-android provision artifacts` remains available as a manual recovery command.

The browser opens Android's account screen on first boot and Google Photos after a Google account is present. Finish these UI-only steps in the browser:

1. Open LSPosed Manager.
2. Enable PixelMask.
3. Scope PixelMask to `com.kinginu.pixelmask` and `com.google.android.apps.photos`.
4. Choose the intended Pixel profile in PixelMask.
5. Open Google Photos, sign in, select `DCIM/Incoming` for backup, and choose the desired backup quality.
6. Force-stop and reopen Google Photos after changing the PixelMask target.

Google login, Photos settings, Magisk modules, LSPosed state, and PixelMask state live under the persistent Android `/data` bind mount.

## Ingestion API

All upload routes require `Authorization: Bearer <INGESTION_TOKEN>`. `/health` is unauthenticated so local routing and container health checks can probe it.

### Network and authentication model

Do not port-forward the ingestion API. For remote phones, the recommended v1 deployment is Tailscale on the phone and Unraid, with `INGESTION_BIND_ADDRESS` set to the Unraid Tailscale address. Use that device's MagicDNS name or tailnet IP as the companion's remote endpoint. Ordinary tailnet traffic does not require selecting an exit node. An exit node is only for routing the phone's general Internet traffic through another device.

Tailscale Serve is also suitable when an HTTPS name is preferred. Inspect `tailscale serve status` before changing it, because a new root handler can replace an existing service mapping. Keep the bearer token enabled as defense in depth even when tailnet access controls restrict which devices can reach the port.

The v1 token is an appliance credential shared by enrolled companion devices. Hono's bearer middleware performs the token validation, and the companion stores the value in Android Keystore. It does not yet provide per-device expiry or revocation. Better Auth is intentionally deferred until Fairth has an owner sign-in and device-approval screen. At that point its device-authorization and bearer plugins can replace the shared token with revocable device sessions. Adding Better Auth before that lifecycle exists would add user, session, migration, recovery, and secret-management state without providing a usable enrollment flow.

References: [Tailscale exit nodes](https://tailscale.com/kb/1103/exit-nodes/), [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve), [Hono bearer authentication](https://hono.dev/docs/middleware/builtin/bearer-auth), [Better Auth device authorization](https://better-auth.com/docs/plugins/device-authorization).

For a simple complete-file upload:

```bash
curl --fail \
  -H "Authorization: Bearer ${INGESTION_TOKEN}" \
  -H 'X-File-Name: IMG_0001.jpg' \
  -H 'X-Device-Id: pixel-8-pro' \
  -H 'X-Album: Camera' \
  --data-binary @IMG_0001.jpg \
  http://unraid.local:3000/upload
```

Large media uses this resumable protocol:

1. `POST /v1/uploads` with `filename`, `size`, optional `sha256`, and metadata JSON.
2. `GET /v1/uploads/:id` to discover chunks already stored.
3. `PUT /v1/uploads/:id/chunks/:index` with one exact-size binary chunk.
4. `POST /v1/uploads/:id/complete` to assemble, verify, and atomically publish it.

Incomplete sessions stay under `/incoming/.uploads` and can resume after service restarts. Completed files are atomically moved to `/incoming/ready` with a metadata sidecar.

For direct NAS copies, write media to `/mnt/user/photos-incoming/drop`. The importer waits until size and modification time remain unchanged for `IMPORTER_STABLE_FOR_MS`. Imported or duplicate source files move to the dated `/incoming/archive` tree rather than being deleted.

## Companion app

The app is in [`companion`](companion). Install and build it on a machine with the Android SDK:

```bash
cd companion
bun install
npx expo run:android
```

In the app:

1. Set the LAN endpoint, usually `http://unraid.local:3000`.
2. Optionally set an HTTPS remote fallback.
3. Paste the ingestion token. It is stored in Android Keystore through Expo SecureStore.
4. Select albums, or leave all albums unselected to watch the full camera roll.
5. Enable automatic sync and the desired Wi-Fi, charging, and time-window rules.

The LAN endpoint is probed first on every drain. If it is unavailable, the app tries the remote endpoint. Queue and resumable-session state persist in SQLite. Media change listeners trigger foreground sync. Android schedules background work opportunistically, with a minimum interval of about 15 minutes. The operating system decides the actual execution time, so Expo background tasks cannot guarantee immediate uploads while the app is suspended.

The managed Expo app targets the recommended ingestion API. Raw SMB is not available from Expo Go without a native SMB module. If an Unraid share is the desired staging target, expose it through this API or a separately secured WebDAV/HTTP gateway.

Cleartext HTTP is enabled for local Android builds so `.local` LAN endpoints work. Never send the bearer token over cleartext Internet links. Use HTTPS, WireGuard, Tailscale, or another trusted private tunnel for remote access.

## Status and operations

```bash
bin/fairth-android status
bin/fairth-android shell
bin/fairth-android logs importer
bin/fairth-android logs ingestion-api
bin/fairth-android reboot
bin/fairth-android down
```

Direct health probes:

```bash
curl http://127.0.0.1:3001/health
curl --fail-with-body http://127.0.0.1:3001/ready
curl http://127.0.0.1:3000/health
```

`/health` reports liveness. Importer `/ready` returns HTTP 503 until Android has booted and Google Photos is installed. It does not attempt to infer whether a Google account is signed in, because Android exposes no stable supported API for that state.

Plan for 4 to 8 GB of RAM, 2 to 4 CPU cores, and enough host storage for Android data plus the incoming and archive trees. KVM is not used by Redroid. Binder support and privileged container access are required.

## Verification

Run repository checks without Android:

```bash
bun install
bun run check
```

For an end-to-end appliance check, upload a small unique image, watch the importer log for an `imported` event, confirm the file appears in `DCIM/Incoming`, then verify its backup state in Google Photos. Import success means the MediaStore row exists. Cloud backup remains controlled and reported by Google Photos.
