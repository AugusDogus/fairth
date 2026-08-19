FROM docker.io/oven/bun:1.3.14-debian AS build
WORKDIR /build
COPY package.json bun.lock tsconfig.base.json ./
COPY apps/companion/package.json ./apps/companion/
COPY apps/web/package.json apps/web/tsconfig.json apps/web/next.config.ts apps/web/postcss.config.mjs apps/web/components.json apps/web/next-env.d.ts ./apps/web/
COPY apps/android-worker/package.json apps/android-worker/tsconfig.json ./apps/android-worker/
COPY packages/android-rpc/package.json packages/android-rpc/tsconfig.json ./packages/android-rpc/
RUN bun install --frozen-lockfile --filter @fairth/web --filter @fairth/android-worker
COPY apps/web/src ./apps/web/src
COPY apps/android-worker/src ./apps/android-worker/src
COPY packages/android-rpc/src ./packages/android-rpc/src
RUN bun --filter @fairth/web build && bun --filter @fairth/android-worker build

FROM docker.io/oven/bun:1.3.14-debian AS linux-runtime
ARG SCRCPY_VERSION=4.1
ARG SCRCPY_SHA256=ad56ae8bfeedf41e824945c11dbf55fcb092b3e615b9b486f48a50e30d389635
RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
      adb \
      bash \
      ca-certificates \
      curl \
      novnc \
      openbox \
      websockify \
      x11vnc \
      xvfb \
    && rm -rf /var/lib/apt/lists/* \
    && curl --fail --location --show-error \
      "https://github.com/Genymobile/scrcpy/releases/download/v${SCRCPY_VERSION}/scrcpy-linux-x86_64-v${SCRCPY_VERSION}.tar.gz" \
      --output /tmp/scrcpy.tar.gz \
    && printf '%s  %s\n' "${SCRCPY_SHA256}" /tmp/scrcpy.tar.gz | sha256sum --check --strict \
    && mkdir -p /opt/scrcpy \
    && tar --extract --gzip --file /tmp/scrcpy.tar.gz --directory /opt/scrcpy --strip-components=1 \
    && ln -s /opt/scrcpy/scrcpy /usr/local/bin/scrcpy \
    && rm /tmp/scrcpy.tar.gz
ENV NODE_ENV=production
COPY --from=build /build/apps/web/.next/standalone /app
COPY --from=build /build/apps/web/.next/static /app/apps/web/.next/static
COPY --from=build /build/apps/android-worker/dist /app/apps/android-worker/dist
COPY apps/android-worker/provision-android.sh /usr/local/bin/fairth-provision-android
COPY apps/android-viewer/entrypoint.sh /usr/local/bin/fairth-android-viewer
COPY deployment/supervisor.sh /usr/local/bin/fairth-supervisor
RUN chmod 0755 \
      /usr/local/bin/fairth-provision-android \
      /usr/local/bin/fairth-android-viewer \
      /usr/local/bin/fairth-supervisor \
    && mkdir -p /data /incoming /artifacts \
    && mkdir -p /tmp/.X11-unix \
    && chmod 1777 /tmp/.X11-unix \
    && chown bun:bun /data /incoming
USER bun
EXPOSE 3000 6080
HEALTHCHECK --interval=30s --timeout=5s --start-period=180s --retries=3 \
  CMD ["/usr/bin/curl", "--fail", "--silent", "http://127.0.0.1:3000/health"]
ENTRYPOINT ["/usr/local/bin/fairth-supervisor"]
