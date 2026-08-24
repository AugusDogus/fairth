#!/bin/sh

set -eu

adb_endpoint="${ADB_ENDPOINT:-android:5555}"
artifacts_directory="${ARTIFACTS_DIRECTORY:-/artifacts}"
state_directory="${PROVISIONING_STATE_DIRECTORY:-/state}"

connect_android() {
  adb connect "${adb_endpoint}" >/dev/null 2>&1 || true
  test "$(adb -s "${adb_endpoint}" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1"
}

wait_for_android() {
  until connect_android; do
    if test "$(adb -s "${adb_endpoint}" shell getprop init.svc.system_server 2>/dev/null | tr -d '\r')" = "running"; then
      adb -s "${adb_endpoint}" shell setprop service.bootanim.exit 1 >/dev/null 2>&1 || true
    fi
    printf '%s\n' 'Waiting for Android to finish booting.'
    sleep 3
  done
}

root_shell() {
  escaped_script="$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
  adb -s "${adb_endpoint}" shell "su 0 sh -c '${escaped_script}'"
}

prepare_magisk_runtime() {
  root_shell 'set -eu; source=/system/etc/init/magisk; target=/data/adb/magisk; test -x "$source/busybox"; test -f "$source/util_functions.sh"; mkdir -p "$target"; cp -f "$source/busybox" "$target/busybox"; cp -f "$source/util_functions.sh" "$target/util_functions.sh"; chmod 0755 "$target/busybox"; chmod 0644 "$target/util_functions.sh"; chown 0:0 "$target/busybox" "$target/util_functions.sh"'
}

artifact_hash() {
  find "${artifacts_directory}" -type f \( -name '*.apk' -o -name '*.zip' \) -print0 2>/dev/null \
    | sort -z \
    | xargs -0 -r sha256sum \
    | sha256sum \
    | cut -d ' ' -f 1
}

configure_pixelmask() {
  pixelmask_package='com.kinginu.pixelmask'
  photos_package='com.google.android.apps.photos'
  lsposed_database='/data/adb/lspd/config/modules_config.db'
  activation_marker="${state_directory}/pixelmask-active"

  verify_pixelmask_active() {
    pixelmask_window='/sdcard/fairth-pixelmask-window.xml'
    adb -s "${adb_endpoint}" shell am force-stop "${pixelmask_package}" >/dev/null 2>&1 || true
    adb -s "${adb_endpoint}" shell am start -W -n "${pixelmask_package}/.MainActivity" >/dev/null 2>&1 || return 1
    sleep 1
    hierarchy="$(adb -s "${adb_endpoint}" shell "rm -f ${pixelmask_window}; uiautomator dump ${pixelmask_window} >/dev/null && cat ${pixelmask_window}" 2>/dev/null | tr -d '\r')"
    adb -s "${adb_endpoint}" shell am force-stop "${pixelmask_package}" >/dev/null 2>&1 || true
    printf '%s' "${hierarchy}" | grep -q 'text="Module Active"'
  }

  pixelmask_path="$(adb -s "${adb_endpoint}" shell pm path "${pixelmask_package}" 2>/dev/null | tr -d '\r' | sed -n '1s/^package://p')"
  if test -z "${pixelmask_path}"; then return; fi
  case "${pixelmask_path}" in
    *[!A-Za-z0-9_./~+=-]*)
      printf 'PixelMask reported an unsafe APK path: %s\n' "${pixelmask_path}" >&2
      return 1
      ;;
  esac

  database_attempt=0
  until root_shell "test -f ${lsposed_database}" >/dev/null 2>&1; do
    database_attempt=$((database_attempt + 1))
    if test "${database_attempt}" -ge 30; then break; fi
    sleep 2
  done
  if test "${database_attempt}" -ge 30; then
    printf '%s\n' 'PixelMask is installed, but the LSPosed configuration database is unavailable.' >&2
    return 1
  fi
  if ! root_shell 'command -v sqlite3' >/dev/null 2>&1; then
    printf '%s\n' 'This Android image does not provide sqlite3, so LSPosed cannot be configured safely.' >&2
    return 1
  fi

  current_scope="$(root_shell "sqlite3 ${lsposed_database} \"SELECT m.enabled || ':' || COUNT(s.app_pkg_name) FROM modules m LEFT JOIN scope s ON s.mid=m.mid AND s.user_id=0 AND s.app_pkg_name IN ('${pixelmask_package}','${photos_package}') WHERE m.module_pkg_name='${pixelmask_package}' GROUP BY m.mid;\"" 2>/dev/null | tr -d '\r')"
  if test "${current_scope}" = '1:2'; then
    if verify_pixelmask_active; then
      printf '%s\n' 'PixelMask is active and enabled for Google Photos in LSPosed.'
      date -u +'%Y-%m-%dT%H:%M:%SZ' >"${activation_marker}"
      return
    fi
    rm -f "${activation_marker}"
    printf '%s\n' 'Android container recreation is required to activate PixelMask.'
    exit 75
  fi

  printf '%s\n' 'Enabling PixelMask for Google Photos in LSPosed.'
  sql="BEGIN IMMEDIATE; INSERT OR IGNORE INTO modules (module_pkg_name,apk_path,enabled) VALUES ('${pixelmask_package}','${pixelmask_path}',1); UPDATE modules SET apk_path='${pixelmask_path}',enabled=1 WHERE module_pkg_name='${pixelmask_package}'; DELETE FROM scope WHERE mid=(SELECT mid FROM modules WHERE module_pkg_name='${pixelmask_package}'); INSERT INTO scope (mid,app_pkg_name,user_id) SELECT mid,'${photos_package}',0 FROM modules WHERE module_pkg_name='${pixelmask_package}'; INSERT INTO scope (mid,app_pkg_name,user_id) SELECT mid,'${pixelmask_package}',0 FROM modules WHERE module_pkg_name='${pixelmask_package}'; COMMIT;"
  if ! root_shell "sqlite3 -bail ${lsposed_database} \"${sql}\""; then
    printf '%s\n' 'LSPosed rejected the PixelMask transaction. Existing configuration was preserved.' >&2
    return 1
  fi

  adb -s "${adb_endpoint}" shell am force-stop "${photos_package}" >/dev/null 2>&1 || true
  verified_scope="$(root_shell "sqlite3 ${lsposed_database} \"SELECT m.enabled || ':' || COUNT(s.app_pkg_name) FROM modules m LEFT JOIN scope s ON s.mid=m.mid AND s.user_id=0 AND s.app_pkg_name IN ('${pixelmask_package}','${photos_package}') WHERE m.module_pkg_name='${pixelmask_package}' GROUP BY m.mid;\"" 2>/dev/null | tr -d '\r')"
  test "${verified_scope}" = '1:2'
  rm -f "${activation_marker}"
  printf '%s\n' 'Android container recreation is required to activate PixelMask.'
  exit 75
}

provision_artifacts() {
  current_hash="$(artifact_hash)"
  previous_hash="$(cat "${state_directory}/artifacts.sha256" 2>/dev/null || true)"
  pending_hash="$(cat "${state_directory}/artifacts.pending.sha256" 2>/dev/null || true)"
  if test "${current_hash}" = "${previous_hash}"; then
    printf '%s\n' 'Android provisioning artifacts are already applied.'
    configure_pixelmask
    return
  fi

  if test "${current_hash}" != "${pending_hash}"; then
    for apk in "${artifacts_directory}"/apks/*.apk; do
      test -f "${apk}" || continue
      printf 'Installing Android package: %s\n' "$(basename "${apk}")"
      adb -s "${adb_endpoint}" install -r "${apk}"
    done

    module_count="$(find "${artifacts_directory}"/modules -maxdepth 1 -type f -name '*.zip' 2>/dev/null | wc -l | tr -d ' ')"
    if test "${module_count}" -gt 0; then
      prepare_magisk_runtime
      root_shell '/sbin/magisk -v' >/dev/null 2>&1
      root_shell '/sbin/magisk --sqlite "INSERT OR REPLACE INTO settings (key,value) VALUES (\"zygisk\",1);"'
      module_index=0
      for module in "${artifacts_directory}"/modules/*.zip; do
        test -f "${module}" || continue
        module_index=$((module_index + 1))
        remote_module="/data/local/tmp/fairth-module-${module_index}.zip"
        printf 'Installing Magisk module: %s\n' "$(basename "${module}")"
        adb -s "${adb_endpoint}" push "${module}" "${remote_module}" >/dev/null
        root_shell "/sbin/magisk --install-module ${remote_module}"
        adb -s "${adb_endpoint}" shell rm -f "${remote_module}" || true
      done
    fi

    printf '%s\n' "${current_hash}" >"${state_directory}/artifacts.pending.sha256"
    if test "${module_count}" -gt 0; then
      printf '%s\n' 'Android container recreation is required to activate the installed Magisk modules.'
      exit 75
    fi
  else
    printf '%s\n' 'Resuming Android provisioning after a required reboot.'
  fi

  configure_pixelmask
  printf '%s\n' "${current_hash}" >"${state_directory}/artifacts.sha256"
  rm -f "${state_directory}/artifacts.pending.sha256"
  printf '%s\n' 'Automatic Android provisioning completed.'
}

mkdir -p "${state_directory}"
wait_for_android
provision_artifacts
