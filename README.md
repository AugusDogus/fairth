# Fairth Android test bed

This repository runs a generic Android 10 (API 29) emulator in a container for APK and integration testing. It uses Google's hosted Android Emulator image and KVM acceleration.

It deliberately does not import physical-device NAND images, hardware-backed keys, device identity, Magisk modules, or Google Photos entitlement modifications.

## Why this runtime

Google's Android Emulator container is the best fit for this host:

- `/dev/kvm` is available, so the emulator can use hardware acceleration.
- It does not require Android binder modules in the host kernel, unlike ReDroid.
- The API 29 image is appropriate for testing software against the last Android version officially available on the first-generation Pixel.
- ADB and emulator gRPC are available through localhost-only ports.
- The selected `-no-metrics` image disables optional emulator usage reporting.

ReDroid is better for dense fleets when the host kernel is intentionally configured with binder support. Docker Android adds a convenient noVNC desktop but uses a larger third-party stack. Anbox Cloud is designed for managed commercial deployments and requires supported Ubuntu hosts.

## Requirements

- Linux on x86-64
- KVM available at `/dev/kvm`
- Podman with Compose support, or Docker with Compose support
- `adb` on the host
- An existing ADB key at `~/.android/adbkey`

Using the hosted image accepts the Android SDK License Agreement.

## Start

```bash
bin/fairth-android check
bin/fairth-android up
bin/fairth-android status
```

The first start downloads a large emulator image. Android data persists in the `fairth_android-data` volume across ordinary restarts.

## Use

```bash
bin/fairth-android shell
bin/fairth-android install path/to/application.apk
bin/fairth-android logs
bin/fairth-android down
```

To use Docker instead of Podman:

```bash
CONTAINER_RUNTIME=docker bin/fairth-android up
```

ADB listens only at `127.0.0.1:5555`. Emulator gRPC listens only at `127.0.0.1:8554`. Do not expose either endpoint directly to a LAN or the internet.

## Reset

Resetting deletes all emulator state:

```bash
bin/fairth-android reset --yes
```
