#!/bin/sh

set -u

adb_endpoint="${ADB_ENDPOINT:-android:5555}"
adb_connect="${ADB_CONNECT:-true}"
public_url="${SETUP_PUBLIC_URL:-https://unraid.local:6080/vnc.html?autoconnect=1&resize=scale}"
setup_password="${SETUP_PASSWORD:?SETUP_PASSWORD is required}"
state_directory="${SETUP_STATE_DIRECTORY:-/state}"

shutdown() {
  trap - INT TERM
  kill -TERM -1 2>/dev/null || true
  exit 0
}

trap shutdown INT TERM

mkdir -p /run/fairth "${state_directory}"
x11vnc -storepasswd "${setup_password}" /run/fairth/vnc.pass >/dev/null
if test ! -s "${state_directory}/setup.crt" || test ! -s "${state_directory}/setup.key"; then
  openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
    -subj '/CN=fairth-setup' \
    -keyout "${state_directory}/setup.key" \
    -out "${state_directory}/setup.crt" >/dev/null 2>&1
  chmod 0600 "${state_directory}/setup.key"
fi

export DISPLAY=:0
Xvfb :0 -screen 0 1280x800x24 -nolisten tcp &
until test -S /tmp/.X11-unix/X0; do sleep 0.1; done
openbox >/tmp/openbox.log 2>&1 &
x11vnc -display :0 -forever -shared -localhost -rfbauth /run/fairth/vnc.pass >/tmp/x11vnc.log 2>&1 &
websockify --web=/usr/share/novnc \
  --cert="${state_directory}/setup.crt" \
  --key="${state_directory}/setup.key" \
  6080 localhost:5900 >/tmp/websockify.log 2>&1 &

printf '%s\n' \
  'Fairth browser setup is starting.' \
  "Open ${public_url}" \
  'Accept the private appliance certificate, then use SETUP_PASSWORD when asked for the VNC password.'

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
    scrcpy --serial "${adb_endpoint}" --no-audio --max-size 1080 --window-title 'Fairth Android Setup' >/tmp/scrcpy.log 2>&1 || true
    sleep 2
  done
}

artifact_hash() {
  find /artifacts -type f \( -name '*.apk' -o -name '*.zip' \) -print0 2>/dev/null \
    | sort -z \
    | xargs -0 -r sha256sum \
    | sha256sum \
    | cut -d ' ' -f 1
}

provision_android() {
  current_hash="$(artifact_hash)"
  previous_hash="$(cat "${state_directory}/artifacts.sha256" 2>/dev/null || true)"
  if test "${current_hash}" = "${previous_hash}"; then
    printf '%s\n' 'Android provisioning artifacts are already applied.'
    return
  fi

  provision_ok=true
  for apk in /artifacts/apks/*.apk; do
    test -f "${apk}" || continue
    printf 'Installing Android package: %s\n' "$(basename "${apk}")"
    if ! adb -s "${adb_endpoint}" install -r "${apk}"; then provision_ok=false; fi
  done

  module_count="$(find /artifacts/modules -maxdepth 1 -type f -name '*.zip' 2>/dev/null | wc -l | tr -d ' ')"
  if test "${module_count}" -gt 0; then
    if adb -s "${adb_endpoint}" shell su -c 'magisk -v' >/dev/null 2>&1; then
      adb -s "${adb_endpoint}" shell su -c 'magisk --sqlite "INSERT OR REPLACE INTO settings (key,value) VALUES (\"zygisk\",1);"' || provision_ok=false
      module_index=0
      for module in /artifacts/modules/*.zip; do
        test -f "${module}" || continue
        module_index=$((module_index + 1))
        remote_module="/data/local/tmp/fairth-module-${module_index}.zip"
        printf 'Installing Magisk module: %s\n' "$(basename "${module}")"
        adb -s "${adb_endpoint}" push "${module}" "${remote_module}" >/dev/null || provision_ok=false
        adb -s "${adb_endpoint}" shell su -c "magisk --install-module ${remote_module}" || provision_ok=false
        adb -s "${adb_endpoint}" shell rm -f "${remote_module}" || true
      done
      adb -s "${adb_endpoint}" reboot >/dev/null 2>&1 || true
      wait_for_android
    else
      printf '%s\n' 'Magisk modules were supplied, but this Android image does not provide Magisk. Select a compatible Redroid image.' >&2
      provision_ok=false
    fi
  fi

  if test "${provision_ok}" = true; then
    printf '%s\n' "${current_hash}" >"${state_directory}/artifacts.sha256"
    printf '%s\n' 'Automatic Android provisioning completed.'
  else
    printf '%s\n' 'Automatic provisioning was incomplete. The browser remains available for recovery.' >&2
  fi
}

has_android_package() {
  adb -s "${adb_endpoint}" shell pm path "$1" >/dev/null 2>&1
}

has_google_account() {
  adb -s "${adb_endpoint}" shell dumpsys account 2>/dev/null | grep -Eq 'Account \{[^}]*type=com\.google[,}]'
}

open_photos_or_store() {
  if has_android_package com.google.android.apps.photos; then
    printf '%s\n' 'A Google account is present. Opening Google Photos.'
    adb -s "${adb_endpoint}" shell monkey -p com.google.android.apps.photos 1 >/dev/null 2>&1 || true
  else
    printf '%s\n' 'A Google account is present. Install Google Photos through Play Store or artifacts/apks.' >&2
    adb -s "${adb_endpoint}" shell monkey -p com.android.vending 1 >/dev/null 2>&1 || true
  fi
}

open_android_onboarding() {
  if ! has_android_package com.google.android.gms || ! has_android_package com.android.vending; then
    printf '%s\n' \
      'This Android image does not include Google Mobile Services and the Play Store.' \
      'Set REDROID_IMAGE to a compatible GApps Redroid image, then recreate the Android container.' >&2
    adb -s "${adb_endpoint}" shell am start -a android.settings.SETTINGS >/dev/null 2>&1 || true
    return
  fi

  if has_google_account; then
    open_photos_or_store
    return
  fi

  printf '%s\n' \
    'Google sign-in is required.' \
    "Open ${public_url} and add the Google account inside Android."
  adb -s "${adb_endpoint}" shell am start -a android.settings.ADD_ACCOUNT_SETTINGS >/dev/null 2>&1 || true
  until has_google_account; do sleep 5; done
  printf '%s\n' 'Google sign-in completed.'
  open_photos_or_store
}

scrcpy_loop &
wait_for_android
provision_android
open_android_onboarding

wait
