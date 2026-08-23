package dev.fairth.backgroundupload

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.ThumbnailUtils
import android.net.Uri
import org.json.JSONArray
import java.io.File
import java.util.UUID

internal class SharedMediaStore(private val context: Context) {
  private val directory = File(context.filesDir, DIRECTORY)
  private val thumbnailDirectory = File(context.filesDir, THUMBNAIL_DIRECTORY)

  fun stage(json: String): List<MediaRecord> {
    val files = JSONArray(json)
    require(files.length() > 0) { "Share at least one photo to Fairth." }
    require(directory.exists() || directory.mkdirs()) { "Fairth could not create durable storage for shared photos." }

    val staged = mutableListOf<MediaRecord>()
    try {
      for (index in 0 until files.length()) {
        val file = files.getJSONObject(index)
        val source = Uri.parse(file.getString("path"))
        val mimeType = file.optString("mimeType").ifBlank { context.contentResolver.getType(source).orEmpty() }
        require(mimeType.startsWith("image/")) { "Fairth only accepts shared photos." }

        val originalName = File(file.optString("fileName")).name.ifBlank { "shared-photo" }
        val identifier = UUID.randomUUID().toString()
        val extension = originalName.substringAfterLast('.', "").takeIf { it.matches(EXTENSION) }
        val storedName = if (extension == null) identifier else "$identifier.$extension"
        val temporary = File(directory, "$storedName.pending")
        val stored = File(directory, storedName)

        try {
          context.contentResolver.openInputStream(source)?.use { input ->
            temporary.outputStream().use { output -> input.copyTo(output) }
          } ?: error("The shared photo $originalName is no longer readable.")
          require(temporary.length() > 0L) { "The shared photo $originalName is empty." }
          require(temporary.renameTo(stored)) { "Fairth could not preserve the shared photo $originalName." }
        } catch (failure: Exception) {
          temporary.delete()
          stored.delete()
          throw failure
        }

        staged += MediaRecord(
          mediaKey = "shared:$identifier",
          uri = Uri.fromFile(stored).toString(),
          filename = originalName,
          mimeType = mimeType,
          bucketId = "shared",
          capturedAt = System.currentTimeMillis(),
          size = stored.length(),
        )
      }
      return staged
    } catch (failure: Exception) {
      staged.forEach { deleteIfManaged(it.uri) }
      throw failure
    }
  }

  fun deleteIfManaged(uri: String) {
    val path = Uri.parse(uri).path ?: return
    val file = File(path)
    val root = runCatching { directory.canonicalFile }.getOrNull() ?: return
    val candidate = runCatching { file.canonicalFile }.getOrNull() ?: return
    if (candidate.parentFile == root) candidate.delete()
  }

  fun preserveThumbnail(record: MediaRecord): String? {
    if (record.bucketId != SHARED_BUCKET || !record.mediaKey.startsWith(SHARED_KEY_PREFIX)) return null
    val identifier = record.mediaKey.removePrefix(SHARED_KEY_PREFIX)
    if (!identifier.matches(IDENTIFIER)) return null
    val source = Uri.parse(record.uri).path?.let(::File) ?: return null
    if (!source.isFile || (!thumbnailDirectory.exists() && !thumbnailDirectory.mkdirs())) return null
    val thumbnail = File(thumbnailDirectory, "$identifier.jpg")
    val temporary = File(thumbnailDirectory, "$identifier.jpg.pending")
    if (thumbnail.isFile) return Uri.fromFile(thumbnail).toString()

    return runCatching {
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeFile(source.path, bounds)
      if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return@runCatching null
      var sampleSize = 1
      while (bounds.outWidth / sampleSize > DECODE_SIZE * 2 || bounds.outHeight / sampleSize > DECODE_SIZE * 2) {
        sampleSize *= 2
      }
      val decoded = BitmapFactory.decodeFile(source.path, BitmapFactory.Options().apply { inSampleSize = sampleSize })
        ?: return@runCatching null
      val cropped = ThumbnailUtils.extractThumbnail(decoded, THUMBNAIL_SIZE, THUMBNAIL_SIZE)
      if (cropped !== decoded) decoded.recycle()
      try {
        temporary.outputStream().use { output ->
          check(cropped.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, output))
        }
        check(temporary.renameTo(thumbnail))
        Uri.fromFile(thumbnail).toString()
      } finally {
        cropped.recycle()
        temporary.delete()
      }
    }.getOrNull()
  }

  private companion object {
    const val DIRECTORY = "shared-uploads"
    const val THUMBNAIL_DIRECTORY = "shared-upload-thumbnails"
    const val SHARED_BUCKET = "shared"
    const val SHARED_KEY_PREFIX = "shared:"
    const val DECODE_SIZE = 384
    const val THUMBNAIL_SIZE = 192
    const val JPEG_QUALITY = 82
    val IDENTIFIER = Regex("[0-9a-fA-F-]{36}")
    val EXTENSION = Regex("[A-Za-z0-9]{1,10}")
  }
}
