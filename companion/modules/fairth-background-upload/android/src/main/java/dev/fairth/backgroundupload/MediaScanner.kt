package dev.fairth.backgroundupload

import android.content.ContentResolver
import android.content.ContentUris
import android.content.Context
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import org.json.JSONArray

internal data class ScanResult(val queued: Int, val hasMore: Boolean)

internal class MediaScanner(private val context: Context, private val database: UploadDatabase) {
  private val resolver: ContentResolver = context.contentResolver

  fun scan(configuration: UploadConfiguration, limit: Int = 500): ScanResult {
    val albumSignature = configuration.albumIds.sorted().joinToString("\u0000")
    if (database.state("album_signature") != albumSignature) {
      database.setState("scan_date_added", "0")
      database.setState("scan_id", "0")
      database.setState("album_signature", albumSignature)
    }
    val dateAdded = database.state("scan_date_added")?.toLongOrNull() ?: 0L
    val lastId = database.state("scan_id")?.toLongOrNull() ?: 0L
    val contentUri = MediaStore.Files.getContentUri("external")
    val selectionParts = mutableListOf(
      "(${MediaStore.Files.FileColumns.MEDIA_TYPE} = ? OR ${MediaStore.Files.FileColumns.MEDIA_TYPE} = ?)",
      "${MediaStore.MediaColumns.SIZE} > 0",
      "(${MediaStore.MediaColumns.DATE_ADDED} > ? OR (${MediaStore.MediaColumns.DATE_ADDED} = ? AND ${MediaStore.MediaColumns._ID} > ?))",
    )
    val arguments = mutableListOf(
      MediaStore.Files.FileColumns.MEDIA_TYPE_IMAGE.toString(),
      MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO.toString(),
      dateAdded.toString(),
      dateAdded.toString(),
      lastId.toString(),
    )
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) selectionParts += "${MediaStore.MediaColumns.IS_PENDING} = 0"
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) selectionParts += "${MediaStore.MediaColumns.IS_TRASHED} = 0"
    if (configuration.albumIds.isNotEmpty()) {
      selectionParts += "${MediaStore.Images.Media.BUCKET_ID} IN (${configuration.albumIds.joinToString(",") { "?" }})"
      arguments += configuration.albumIds
    }

    var queued = 0
    var visited = 0
    resolver.query(
      contentUri,
      PROJECTION,
      selectionParts.joinToString(" AND "),
      arguments.toTypedArray(),
      "${MediaStore.MediaColumns.DATE_ADDED} ASC, ${MediaStore.MediaColumns._ID} ASC",
    )?.use { cursor ->
      while (cursor.moveToNext() && visited < limit) {
        val id = cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.MediaColumns._ID))
        val added = cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DATE_ADDED))
        val mediaType = cursor.getInt(cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.MEDIA_TYPE))
        val fallbackMime = if (mediaType == MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO) "video/mp4" else "image/jpeg"
        val record = MediaRecord(
          mediaKey = "external:$id",
          uri = ContentUris.withAppendedId(contentUri, id).toString(),
          filename = cursor.optionalString(MediaStore.MediaColumns.DISPLAY_NAME) ?: "media-$id",
          mimeType = cursor.optionalString(MediaStore.MediaColumns.MIME_TYPE) ?: fallbackMime,
          bucketId = cursor.optionalString(MediaStore.Images.Media.BUCKET_ID) ?: "",
          capturedAt = cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_TAKEN)).takeIf { it > 0L } ?: added * 1_000L,
          size = cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.SIZE)),
        )
        if (database.enqueue(record)) queued += 1
        database.setState("scan_date_added", added.toString())
        database.setState("scan_id", id.toString())
        visited += 1
      }
    }
    return ScanResult(queued, visited == limit)
  }

  fun enqueueManual(json: String): Int {
    val choices = JSONArray(json)
    var queued = 0
    for (index in 0 until choices.length()) {
      val choice = choices.getJSONObject(index)
      val uri = Uri.parse(choice.getString("uri"))
      val record = recordForUri(uri, choice.optString("filename"), choice.optLong("creationTime")) ?: continue
      if (database.enqueue(record)) queued += 1
    }
    return queued
  }

  private fun recordForUri(uri: Uri, fallbackName: String, fallbackCapturedAt: Long): MediaRecord? {
    resolver.query(uri, PROJECTION, null, null, null)?.use { cursor ->
      if (!cursor.moveToFirst()) return null
      val id = cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.MediaColumns._ID))
      val added = cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DATE_ADDED))
      val size = cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.SIZE))
      if (size <= 0L) return null
      return MediaRecord(
        mediaKey = "external:$id",
        uri = uri.toString(),
        filename = cursor.optionalString(MediaStore.MediaColumns.DISPLAY_NAME) ?: fallbackName.ifBlank { "media-$id" },
        mimeType = cursor.optionalString(MediaStore.MediaColumns.MIME_TYPE) ?: resolver.getType(uri) ?: "application/octet-stream",
        bucketId = cursor.optionalString(MediaStore.Images.Media.BUCKET_ID) ?: "manual",
        capturedAt = cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_TAKEN)).takeIf { it > 0L }
          ?: fallbackCapturedAt.takeIf { it > 0L }
          ?: added * 1_000L,
        size = size,
      )
    }
    return null
  }

  private fun android.database.Cursor.optionalString(column: String): String? {
    val index = getColumnIndexOrThrow(column)
    return if (isNull(index)) null else getString(index)
  }

  private companion object {
    val PROJECTION = arrayOf(
      MediaStore.MediaColumns._ID,
      MediaStore.MediaColumns.DISPLAY_NAME,
      MediaStore.MediaColumns.MIME_TYPE,
      MediaStore.MediaColumns.SIZE,
      MediaStore.MediaColumns.DATE_ADDED,
      MediaStore.Images.Media.DATE_TAKEN,
      MediaStore.Images.Media.BUCKET_ID,
      MediaStore.Files.FileColumns.MEDIA_TYPE,
    )
  }
}
