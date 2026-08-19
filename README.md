# Fairth Android test bed

This repository runs a generic Android 10 (API 29) emulator on an Unraid server for APK and integration testing. It uses Google's hosted Android Emulator image, Docker, and KVM acceleration.

It deliberately does not import physical-device NAND images, hardware-backed keys, device identity, Magisk modules, or Google Photos entitlement modifications.

## Why this runtime

Google's Android Emulator container is the best fit for the target server:

- The Unraid server has virtualization support and exposes `/dev/kvm`, so the emulator can use hardware acceleration.
- It does not require Android binder modules in the host kernel, unlike ReDroid.
- The API 29 image is appropriate for testing software against the last Android version officially available on the first-generation Pixel.
- ADB and emulator gRPC are available through localhost-only ports.
- The selected `-no-metrics` image disables optional emulator usage reporting.

ReDroid is better for dense fleets when the host kernel is intentionally configured with binder support. Docker Android adds a convenient noVNC desktop but uses a larger third-party stack. Anbox Cloud is designed for managed commercial deployments and requires supported Ubuntu hosts.

## Requirements

- Unraid on x86-64
- KVM available at `/dev/kvm`
- Docker Engine with the Compose v2 plugin
- An existing ADB key pair copied from a trusted workstation

Using the hosted image accepts the Android SDK License Agreement.

## Unraid setup

Keep emulator state in Unraid appdata so it does not consume space inside `docker.img`:

```bash
mkdir -p /mnt/user/appdata/fairth/android-data
mkdir -p /mnt/user/appdata/fairth/adb
```

Copy `~/.android/adbkey` and `~/.android/adbkey.pub` from a trusted development workstation into `/mnt/user/appdata/fairth/adb`, then protect the private key:

```bash
chmod 600 /mnt/user/appdata/fairth/adb/adbkey
```

Copy `.env.example` to `.env`, review the paths, then start the stack:

```bash
bin/fairth-android check
bin/fairth-android up
bin/fairth-android status
```

The first start downloads a large emulator image and builds a small ADB sidecar. Android data persists under `/mnt/user/appdata/fairth/android-data` across ordinary restarts. The sidecar keeps Android tooling out of the Unraid host.

## Use

```bash
bin/fairth-android shell
bin/fairth-android install path/to/application.apk
bin/fairth-android logs
bin/fairth-android down
```

For local development with Podman, override the runtime and appdata paths:

```bash
CONTAINER_RUNTIME=podman \
ANDROID_DATA_PATH="$PWD/android-data" \
ANDROID_ADB_KEY_DIRECTORY="$HOME/.android" \
bin/fairth-android up
```

ADB listens only at `127.0.0.1:5555`. Emulator gRPC listens only at `127.0.0.1:8554`. Do not expose either endpoint directly to a LAN or the internet.
