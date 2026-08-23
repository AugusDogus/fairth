package dev.fairth.backgroundupload

import android.content.Context
import android.net.Uri
import org.json.JSONArray
import java.io.File
import java.util.UUID

internal class SharedMediaStore(private val context: Context) {
  private val directory = File(context.filesDir, DIRECTORY)

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

  private companion object {
    const val DIRECTORY = "shared-uploads"
    val EXTENSION = Regex("[A-Za-z0-9]{1,10}")
  }
}
