package dev.fairth.backgroundupload

import android.content.Context
import org.json.JSONObject
import java.net.URI
import java.util.Calendar

internal data class UploadConfiguration(
  val primaryEndpoint: String,
  val lanEndpoint: String?,
  val deviceId: String,
  val wifiOnly: Boolean,
  val chargingOnly: Boolean,
  val automaticSync: Boolean,
  val windowStart: Int,
  val windowEnd: Int,
  val albumIds: Set<String>,
) {
  fun endpoints(): List<String> = listOfNotNull(lanEndpoint, primaryEndpoint).distinct()

  fun isWithinWindow(hour: Int = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)): Boolean {
    if (windowStart == 0 && windowEnd == 24) return true
    if (windowStart == windowEnd) return true
    return if (windowStart < windowEnd) hour in windowStart until windowEnd
    else hour >= windowStart || hour < windowEnd
  }

  fun toJson(): String = JSONObject()
    .put("primaryEndpoint", primaryEndpoint)
    .put("lanEndpoint", lanEndpoint ?: "")
    .put("deviceId", deviceId)
    .put("wifiOnly", wifiOnly)
    .put("chargingOnly", chargingOnly)
    .put("automaticSync", automaticSync)
    .put("windowStart", windowStart)
    .put("windowEnd", windowEnd)
    .put("albumIds", albumIds.toList())
    .toString()

  companion object {
    private const val PREFERENCES = "fairth-background-upload"
    private const val CONFIGURATION = "configuration"

    fun parse(json: String): UploadConfiguration {
      val value = JSONObject(json)
      val primary = endpoint(value.optString("primaryEndpoint"))
      val lan = endpoint(value.optString("lanEndpoint")).ifBlank { null }
      require(primary.isNotBlank() || lan != null) { "Enter at least one ingestion endpoint before enabling uploads." }
      val deviceId = value.optString("deviceId").trim()
      require(deviceId.isNotBlank()) { "Device ID cannot be empty." }
      val start = value.optInt("windowStart", 0)
      val end = value.optInt("windowEnd", 24)
      require(start in 0..23 && end in 0..24) { "Sync hours must be between 0 and 24." }
      val albums = value.optJSONArray("albumIds")
      val albumIds = buildSet {
        if (albums != null) for (index in 0 until albums.length()) {
          val id = albums.optString(index).trim()
          if (id.isNotBlank()) add(id)
        }
      }
      return UploadConfiguration(
        primaryEndpoint = primary,
        lanEndpoint = lan,
        deviceId = deviceId,
        wifiOnly = value.optBoolean("wifiOnly", true),
        chargingOnly = value.optBoolean("chargingOnly", false),
        automaticSync = value.optBoolean("automaticSync", false),
        windowStart = start,
        windowEnd = end,
        albumIds = albumIds,
      )
    }

    fun load(context: Context): UploadConfiguration? {
      val json = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).getString(CONFIGURATION, null) ?: return null
      return runCatching { parse(json) }.getOrNull()
    }

    fun save(context: Context, configuration: UploadConfiguration) {
      context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit()
        .putString(CONFIGURATION, configuration.toJson())
        .apply()
    }

    private fun endpoint(raw: String): String {
      val trimmed = raw.trim().trimEnd('/')
      if (trimmed.isBlank()) return ""
      val uri = runCatching { URI(trimmed) }.getOrNull()
      require(uri != null && (uri.scheme == "http" || uri.scheme == "https") && uri.host != null) {
        "Ingestion endpoints must be absolute HTTP or HTTPS URLs."
      }
      return trimmed
    }
  }
}
