package dev.fairth.backgroundupload

import android.content.ContentResolver
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.FileInputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

internal class UploadFailure(message: String, val authenticationFailed: Boolean = false) : Exception(message)

internal data class UploadSession(
  val uploadId: String,
  val chunkSize: Long,
  val receivedChunks: Set<Int>,
)

internal data class EndpointChoice(
  val endpoint: String?,
  val error: String?,
)

internal class IngestionClient(private val resolver: ContentResolver) {
  fun chooseEndpoint(configuration: UploadConfiguration): EndpointChoice {
    val failures = mutableListOf<String>()
    for (endpoint in configuration.endpoints()) {
      try {
        val connection = connection("$endpoint/health", "GET")
        try {
          val status = connection.responseCode
          if (status in 200..299) return EndpointChoice(endpoint, null)
          failures += "HTTP $status"
        } finally {
          connection.disconnect()
        }
      } catch (failure: Exception) {
        failures += failure.message?.takeIf { it.isNotBlank() } ?: failure.javaClass.simpleName
      }
    }
    return EndpointChoice(null, failures.joinToString("; ").ifBlank { "No ingestion endpoint is configured." })
  }

  fun upload(base: String, token: String, configuration: UploadConfiguration, record: UploadRecord, saveUploadId: (String) -> Unit) {
    var session = record.uploadId?.let { resumeSession(base, token, it) }
    if (session == null) {
      session = createSession(base, token, configuration, record.media)
      saveUploadId(session.uploadId)
    }
    val chunks = ((record.media.size + session.chunkSize - 1L) / session.chunkSize).toInt()
    for (index in 0 until chunks) {
      if (index in session.receivedChunks) continue
      val offset = index * session.chunkSize
      val length = minOf(session.chunkSize, record.media.size - offset)
      uploadChunk(base, token, session.uploadId, index, record.media.uri, offset, length)
    }
    request(base, token, "POST", "/v1/uploads/${session.uploadId}/complete", ByteArray(0))
  }

  fun heartbeat(base: String, token: String) {
    request(base, token, "GET", "/v1/status")
  }

  private fun createSession(base: String, token: String, configuration: UploadConfiguration, media: MediaRecord): UploadSession {
    val body = JSONObject()
      .put("filename", media.filename)
      .put("size", media.size)
      .put(
        "metadata",
        JSONObject()
          .put("deviceId", configuration.deviceId)
          .put("album", media.bucketId)
          .put("capturedAt", isoDate(media.capturedAt)),
      )
      .toString()
      .toByteArray(Charsets.UTF_8)
    return parseSession(request(base, token, "POST", "/v1/uploads", body, "application/json"))
  }

  private fun resumeSession(base: String, token: String, uploadId: String): UploadSession? = try {
    parseSession(request(base, token, "GET", "/v1/uploads/$uploadId"))
  } catch (failure: UploadFailure) {
    if (!failure.authenticationFailed && failure.message?.startsWith("HTTP 404:") == true) null else throw failure
  }

  private fun uploadChunk(base: String, token: String, uploadId: String, index: Int, uri: String, offset: Long, length: Long) {
    val connection = authenticatedConnection(base, token, "/v1/uploads/$uploadId/chunks/$index", "PUT")
    connection.setFixedLengthStreamingMode(length)
    connection.doOutput = true
    try {
      connection.outputStream.use { output ->
        val mediaUri = Uri.parse(uri).let { parsed ->
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && parsed.scheme == ContentResolver.SCHEME_CONTENT) {
            MediaStore.setRequireOriginal(parsed)
          } else {
            parsed
          }
        }
        resolver.openFileDescriptor(mediaUri, "r")?.use { descriptor ->
          FileInputStream(descriptor.fileDescriptor).use { input ->
            input.channel.position(offset)
            copyExactly(input, output, length)
          }
        } ?: throw UploadFailure("The media file is no longer readable on this device.")
      }
      ensureSuccess(connection)
    } finally {
      connection.disconnect()
    }
  }

  private fun request(
    base: String,
    token: String,
    method: String,
    path: String,
    body: ByteArray? = null,
    contentType: String? = null,
  ): String {
    val connection = authenticatedConnection(base, token, path, method)
    if (body != null) {
      connection.doOutput = true
      connection.setFixedLengthStreamingMode(body.size)
      if (contentType != null) connection.setRequestProperty("content-type", contentType)
    }
    try {
      if (body != null) connection.outputStream.use { it.write(body) }
      ensureSuccess(connection)
      return connection.inputStream.use { it.readBounded() }
    } finally {
      connection.disconnect()
    }
  }

  private fun authenticatedConnection(base: String, token: String, path: String, method: String): HttpURLConnection =
    connection("$base$path", method).apply { setRequestProperty("authorization", "Bearer $token") }

  private fun connection(url: String, method: String): HttpURLConnection = (URL(url).openConnection() as HttpURLConnection).apply {
    requestMethod = method
    connectTimeout = 5_000
    readTimeout = 60_000
    useCaches = false
    setRequestProperty("accept", "application/json")
    setRequestProperty("user-agent", "Fairth Companion Android")
  }

  private fun ensureSuccess(connection: HttpURLConnection) {
    val status = connection.responseCode
    if (status in 200..299) return
    val response = connection.errorStream?.use { it.readBounded() }.orEmpty()
    val detail = runCatching { JSONObject(response).optString("message") }.getOrNull().orEmpty()
    val message = if (detail.isBlank()) "HTTP $status: the ingestion service rejected the request." else "HTTP $status: $detail"
    throw UploadFailure(message, status == 401 || status == 403)
  }

  private fun parseSession(json: String): UploadSession {
    val value = runCatching { JSONObject(json) }.getOrElse { throw UploadFailure("The ingestion service returned an invalid upload session.") }
    val uploadId = value.optString("uploadId")
    val chunkSize = value.optLong("chunkSize")
    if (uploadId.isBlank() || chunkSize <= 0L) throw UploadFailure("The ingestion service returned an incomplete upload session.")
    val received = value.optJSONArray("receivedChunks")
    val chunks = buildSet {
      if (received != null) for (index in 0 until received.length()) {
        val chunk = received.optInt(index, -1)
        if (chunk >= 0) add(chunk)
      }
    }
    return UploadSession(uploadId, chunkSize, chunks)
  }

  private fun copyExactly(input: InputStream, output: java.io.OutputStream, expected: Long) {
    val buffer = ByteArray(256 * 1_024)
    var remaining = expected
    while (remaining > 0L) {
      val read = input.read(buffer, 0, minOf(buffer.size.toLong(), remaining).toInt())
      if (read < 0) throw UploadFailure("The media file ended before its recorded size. It remains queued for retry.")
      output.write(buffer, 0, read)
      remaining -= read
    }
  }

  private fun InputStream.readBounded(): String {
    val output = ByteArrayOutputStream()
    val buffer = ByteArray(4_096)
    var total = 0
    while (total < MAX_RESPONSE_BYTES) {
      val read = read(buffer, 0, minOf(buffer.size, MAX_RESPONSE_BYTES - total))
      if (read < 0) break
      output.write(buffer, 0, read)
      total += read
    }
    return output.toString(Charsets.UTF_8.name())
  }

  private fun isoDate(epochMilliseconds: Long): String =
    SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSXXX", Locale.US).format(Date(epochMilliseconds))

  private companion object {
    const val MAX_RESPONSE_BYTES = 64 * 1_024
  }
}
