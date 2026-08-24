#!/bin/sh

set -u

adb_endpoint="${ADB_ENDPOINT:-android:5555}"
adb_connect="${ADB_CONNECT:-true}"
public_url="${ANDROID_VIEWER_URL:-http://127.0.0.1:6080/vnc.html?autoconnect=1&resize=scale}"
viewer_password="${ANDROID_VIEWER_PASSWORD:-}"

shutdown() {
  trap - INT TERM
  kill -TERM -1 2>/dev/null || true
  exit 0
}

trap shutdown INT TERM

mkdir -p /tmp/fairth

export DISPLAY=:0
Xvfb :0 -screen 0 540x1200x24 -nolisten tcp &
until test -S /tmp/.X11-unix/X0; do sleep 0.1; done
openbox >/tmp/openbox.log 2>&1 &
if test -n "${viewer_password}"; then
  x11vnc -storepasswd "${viewer_password}" /tmp/fairth/vnc.pass >/dev/null
  x11vnc -display :0 -forever -shared -localhost -rfbauth /tmp/fairth/vnc.pass >/tmp/x11vnc.log 2>&1 &
else
  x11vnc -display :0 -forever -shared -localhost -nopw >/tmp/x11vnc.log 2>&1 &
fi
websockify --web=/usr/share/novnc 6080 localhost:5900 >/tmp/websockify.log 2>&1 &

printf '%s\n' \
  'Fairth Android viewer is starting.' \
  "Open ${public_url}" \
  'Keep this private HTTP service on a trusted LAN or tailnet.'

connect_android() {
  if test "${adb_connect}" = true; then
    adb connect "${adb_endpoint}" >/dev/null 2>&1 || true
  fi
  test "$(adb -s "${adb_endpoint}" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1"
}

wait_for_android() {
  until connect_android; do
    printf '%s\n' 'Waiting for Android to finish booting.'
    sleep 3
  done
}

scrcpy_loop() {
  while true; do
    wait_for_android
    scrcpy --serial "${adb_endpoint}" --no-audio --max-size 1080 --fullscreen --window-borderless --window-title 'Fairth Android Setup' >/tmp/scrcpy.log 2>&1 || true
    sleep 2
  done
}

scrcpy_loop &
wait
