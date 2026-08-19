# Fairth photo bridge

Fairth is a self-hosted photo ingestion appliance. An Expo companion app queues media from a phone, uploads it over HTTP in resumable chunks, and an Android worker places each completed file in Android MediaStore. The official Google Photos Android app remains the only component that uploads to Google Photos.

```text
                  Non-privileged Fairth container       Privileged Redroid
                 ┌──────────────────────────────────┐   ┌─────────────────┐
Expo companion ─▶│ Next.js → /incoming → worker    │──▶│ Android / Photos│
Owner browser ──▶│ onboarding → scrcpy/noVNC       │ADB│ persistent /data│
                 └──────────────────────────────────┘   └─────────────────┘
```

Fairth deploys as two containers on a private Docker network. The non-privileged application container runs Next.js, the Android worker, and the scrcpy/noVNC viewer. The privileged Redroid container runs only Android. ADB crosses the private network and is never published to the host. The `apps/` and `packages/` boundaries organize the application code without creating more deployment units.

## What is included

- Redroid with persistent `/data` and private ADB access
- Better Auth owner account with device-code enrollment and revocable Bearer sessions
- Chunked, resumable upload sessions for large videos
- Atomic publication, so the Android worker never sees a partial upload
- Stabilization checks for files copied directly into an Unraid share
- SQLite import history, SHA-256 deduplication, bounded exponential retries, and an archive
- MediaStore verification after every ADB import
- Health details for Android boot, ADB, Google Photos, queue state, and worker state
- Expo SDK 57 app with MediaLibrary selection and a local Kotlin module for native scanning, queueing, LAN-first uploads, and WorkManager scheduling
- Owner-only onboarding status in the Next.js app, with a private browser-based Android viewer for Google consent
- Automatic APK, Magisk module, LSPosed, and PixelMask artifact provisioning

## Important runtime facts

Redroid needs Android Binder support from the host kernel. It does not use `/dev/kvm`. On Unraid, confirm that `/dev/binder` or a compatible Binder setup exists before deploying.

The stock `redroid/redroid` image is AOSP. It does not include Google Mobile Services, Google Photos, Magisk, or ARM translation. Fairth therefore requires `REDROID_IMAGE` to name an image you built or obtained under licenses that permit those packages. The included builder uses Android 11 because its x86-64 GApps and ARM native-bridge path is the combination its upstream builder documents as working.

PixelMask does not replace Magisk or Zygisk. It is an LSPosed module, and LSPosed requires Magisk/Zygisk or an equivalent root framework. PixelMask currently publishes an `arm64-v8a` application. An x86-64 Unraid host therefore needs a Redroid image with a working ARM native bridge as well as GApps and Magisk. `bin/fairth-android build-image` uses a pinned revision of the community `redroid-script` project to build that image locally. Review that third-party input and the applicable package licenses before running it. Fairth does not commit or redistribute the resulting proprietary packages.

References: [Redroid documentation](https://github.com/remote-android/redroid-doc), [Redroid GMS build notes](https://github.com/remote-android/redroid-doc/tree/master/android-builder-docker), [LSPosed installation](https://github.com/LSPosed/LSPosed/wiki/How-to-use-it), and [PixelMask instructions](https://github.com/Xposed-Modules-Repo/com.kinginu.pixelmask).

## Unraid setup

The host needs rootful Docker, Android Binder support, `git`, Python 3 with `venv`, and `lzip`. Docker Compose is not used. Redroid will not boot in rootless Podman even when the kernel registers Binder.

Copy the environment template:

```bash
cp .env.example .env
```

The defaults use three Docker-managed named volumes for application state, Android state, and incoming media. No host directories or `chown` commands are required. To make incoming media directly visible on Unraid, replace `INCOMING_PATH` with an absolute `/mnt/user/...` path.

Set `PUBLIC_BASE_URL` and `ANDROID_VIEWER_URL` to addresses reachable by the intended clients. The application works directly over a trusted LAN, Tailscale IP, or MagicDNS name. Tailscale Serve can add private HTTPS. Optional Traefik labels expose only the web port publicly. See [Networking and TLS](docs/networking.md). Generate the eight-character `ANDROID_VIEWER_PASSWORD` as shown in `.env.example`. Fairth generates and persists the Better Auth secret unless `BETTER_AUTH_SECRET` is explicitly configured.

Build the local Redroid and Fairth images once. This downloads the official Redroid base and pinned third-party GApps, Magisk, and native-bridge inputs:

```bash
bin/fairth-android build-image
```

Start both containers with one wrapper command. It uses ordinary `docker network` and `docker run` commands, not Compose:

```bash
bin/fairth-android up
```

The equivalent deployment is one private network plus two containers:

```bash
docker network create fairth

docker run -d \
  --name fairth-android \
  --privileged \
  --restart unless-stopped \
  --network fairth \
  --network-alias android \
  -v fairth-android-data:/data \
  localhost/fairth-redroid:11-gapps-ndk-magisk \
  androidboot.hardware=redroid \
  androidboot.redroid_width=1080 \
  androidboot.redroid_height=2400 \
  androidboot.redroid_dpi=420 \
  androidboot.redroid_fps=30 \
  androidboot.use_memfd=true \
  ro.product.cpu.abilist=x86_64,arm64-v8a,x86,armeabi-v7a \
  ro.product.cpu.abilist64=x86_64,arm64-v8a \
  ro.product.cpu.abilist32=x86,armeabi-v7a \
  ro.dalvik.vm.isa.arm=x86 \
  ro.dalvik.vm.isa.arm64=x86_64 \
  ro.enable.native.bridge.exec=1 \
  ro.vendor.enable.native.bridge.exec=1 \
  ro.vendor.enable.native.bridge.exec64=1 \
  ro.dalvik.vm.native.bridge=libndk_translation.so \
  ro.ndk_translation.version=0.2.3

docker run -d \
  --name fairth \
  --restart unless-stopped \
  --network fairth \
  --env-file .env \
  -e ADB_ENDPOINT=android:5555 \
  -p 3000:3000 \
  -p 6080:6080 \
  -v fairth-data:/data \
  -v fairth-incoming:/incoming \
  -v "$PWD/artifacts:/artifacts:ro" \
  localhost/fairth:latest
```

The wrapper supplies the same Redroid properties using display values from `.env`. Create the owner, then open `/onboarding`. That page verifies automated Android setup and opens the Android screens needed for Google sign-in and Photos consent.

Google does not provide a supported way for a separate web OAuth callback to inject an account into Android's system account store. The browser view keeps credential entry in Google's Android UI. Fairth never receives or stores the Google password. The persistent Android `/data` mount preserves the resulting account across container restarts.

ADB stays on the private Docker network, and the worker API stays on loopback inside the Fairth container. Only ports 3000 and 6080 are published. Keep the Android viewer on a trusted LAN, tailnet, or SSH tunnel because it provides full control of Android.

## Automated Android provisioning

Place user-supplied files as described in [`artifacts/README.md`](artifacts/README.md):

```text
artifacts/apks/*.apk       Google Photos, PixelMask, and other required APKs
artifacts/modules/*.zip    LSPosed Zygisk module
```

The Android worker hashes these files at startup, installs changed APKs, enables Zygisk, installs changed modules, and reboots Android when needed. It then enables PixelMask in LSPosed, replaces only PixelMask's scope with `com.kinginu.pixelmask` and `com.google.android.apps.photos`, restarts Android, and verifies the saved state. PixelMask's upstream default is the original Pixel profile, so Fairth does not need to write private PixelMask preferences. Applied artifact state persists, so ordinary restarts do not reinstall it. Use the onboarding page or `bin/fairth-android reconcile` to retry after fixing a missing artifact or Android prerequisite.

The authenticated `/onboarding` page reports every automatic check and opens the remaining UI-only steps in the private Android viewer:

1. Complete Google's Android account sign-in.
2. Open Google Photos and approve backup for `DCIM/Incoming`.

Google login and Photos consent cannot be injected through a supported API. Fairth leaves them in Google's UI and never receives the Google password. Google login, Photos settings, Magisk modules, LSPosed state, and PixelMask state live under the persistent Android `/data` volume.

## Web app and upload API

All upload routes require a Better Auth device session as `Authorization: Bearer <session-token>`. `/health` is unauthenticated so local routing and container health checks can probe it.

### Network and authentication model

The same two-container deployment works over LAN and direct Tailscale addresses. Tailscale Serve can proxy the host ports when browser-trusted private HTTPS is preferred. For optional public access, `TRAEFIK_ENABLE=true` attaches only the Fairth application container to Traefik. Cloudflare can provide DNS while Traefik terminates TLS. Exact configurations and security boundaries are documented in [Networking and TLS](docs/networking.md).

The companion requests an eight-character device code, opens Fairth's authenticated approval page, and polls until the owner approves it. Better Auth then issues a one-year revocable session. The owner can inspect and revoke companion sessions at `/devices`; revocation takes effect on the next API request. Auth data and Android data persist in separate named volumes.

References: [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve), [Traefik Docker routing](https://doc.traefik.io/traefik/routing/providers/docker/), and [Better Auth device authorization](https://better-auth.com/docs/plugins/device-authorization).

For a simple complete-file upload:

```bash
FAIRTH_BASE_URL=https://unraid.example-tailnet.ts.net
curl --fail \
  -H "Authorization: Bearer ${FAIRTH_DEVICE_TOKEN}" \
  -H 'X-File-Name: IMG_0001.jpg' \
  -H 'X-Device-Id: pixel-8-pro' \
  -H 'X-Album: Camera' \
  --data-binary @IMG_0001.jpg \
  "${FAIRTH_BASE_URL}/upload"
```

Large media uses this resumable protocol:

1. `POST /v1/uploads` with `filename`, `size`, optional `sha256`, and metadata JSON.
2. `GET /v1/uploads/:id` to discover chunks already stored.
3. `PUT /v1/uploads/:id/chunks/:index` with one exact-size binary chunk.
4. `POST /v1/uploads/:id/complete` to assemble, verify, and atomically publish it.

Incomplete sessions stay under `/incoming/.uploads` and can resume after service restarts. Completed files are atomically moved to `/incoming/ready` with a metadata sidecar.

For direct NAS copies, set `INCOMING_PATH` to a writable Unraid share such as `/mnt/user/photos-incoming`, then write media to its `drop` directory. The Android worker waits until size and modification time remain unchanged for `ANDROID_WORKER_STABLE_FOR_MS`. Imported or duplicate source files move to the dated `/incoming/archive` tree rather than being deleted.

## Companion app

The app is in [`apps/companion`](apps/companion). Install and build it on a machine with the Android SDK:

```bash
cd apps/companion
bun install
npx expo run:android
```

In the app:

1. Set the remote endpoint to the Tailscale Serve or public Traefik URL.
2. Optionally set a trusted-LAN endpoint for LAN-first uploads.
3. Tap **Enroll this device**, sign in as the Fairth owner, and approve the displayed code.
4. Select albums, or leave all albums unselected to watch the full camera roll.
5. Enable automatic sync and the desired Wi-Fi, charging, and time-window rules.

The companion requires a development or release Android build. It does not run in Expo Go because its uploader is a local native module. The LAN endpoint is probed first on every run. If unavailable, the uploader tries the remote endpoint.

Android WorkManager performs MediaStore discovery, persistent SQLite queueing, and resumable HTTP transfer without launching the Expo JavaScript runtime. Work is restored after app-process death and phone reboot, honors Wi-Fi and charging constraints, and runs at Android's minimum periodic interval of 15 minutes. Active large transfers use a `dataSync` foreground notification and stop after a bounded run; remaining chunks continue in later work. Android still controls exact timing. Explicitly force-stopping the app disables all of its scheduled work until the user launches it again, which no Android app can bypass.

The managed Expo app targets the recommended ingestion API. Raw SMB is not available from Expo Go without a native SMB module. If an Unraid share is the desired staging target, expose it through this API or a separately secured WebDAV/HTTP gateway.

Cleartext HTTP is enabled for local Android builds so `.local` LAN endpoints work. Never send owner credentials or a device session over cleartext Internet links. Use HTTPS, WireGuard, Tailscale, or another trusted private tunnel for remote access.

## Status and operations

```bash
bin/fairth-android status
bin/fairth-android shell
bin/fairth-android logs
bin/fairth-android android-logs
bin/fairth-android reboot
bin/fairth-android down
```

Direct health probes:

```bash
curl http://127.0.0.1:3000/health
```

`/health` reports web liveness. `bin/fairth-android status` checks the private Android worker readiness endpoint, which returns HTTP 503 until Android has booted and Google Photos is installed. The owner onboarding page additionally checks the Android account registry for the presence of a Google account. It does not read credentials or claim that Photos backup consent is complete.

Plan for 4 to 8 GB of RAM, 2 to 4 CPU cores, and enough host storage for Android data plus the incoming and archive trees. KVM is not used by Redroid. Binder support and privileged container access are required.

## Verification

Run repository checks without Android:

```bash
bun install
bun run check
```

For an end-to-end appliance check, upload a small unique image, watch the Android worker log for an `imported` event, confirm the file appears in `DCIM/Incoming`, then verify its backup state in Google Photos. Import success means the MediaStore row exists. Cloud backup remains controlled and reported by Google Photos.

The companion's Kotlin module can be compiled without a phone after Expo prebuild:

```bash
cd apps/companion
npx expo prebuild --platform android --no-install
./android/gradlew :fairth-background-upload:compileDebugKotlin
```

[Argent](https://github.com/software-mansion/argent) can drive an Android emulator or an ADB-connected physical phone for repeatable UI and process-restart smoke tests.
