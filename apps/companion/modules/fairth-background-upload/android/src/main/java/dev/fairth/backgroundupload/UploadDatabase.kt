package dev.fairth.backgroundupload

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

internal data class MediaRecord(
  val mediaKey: String,
  val uri: String,
  val filename: String,
  val mimeType: String,
  val bucketId: String,
  val capturedAt: Long,
  val size: Long,
)

internal data class UploadRecord(
  val media: MediaRecord,
  val uploadId: String?,
  val attempts: Int,
)

internal class UploadDatabase(context: Context) : SQLiteOpenHelper(context, "fairth-background-upload.sqlite", null, 1) {
  override fun onConfigure(database: SQLiteDatabase) {
    database.setForeignKeyConstraintsEnabled(true)
    database.enableWriteAheadLogging()
  }

  override fun onCreate(database: SQLiteDatabase) {
    database.execSQL(
      """CREATE TABLE upload_queue (
        media_key TEXT PRIMARY KEY,
        uri TEXT NOT NULL,
        filename TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        bucket_id TEXT NOT NULL,
        captured_at INTEGER NOT NULL,
        size INTEGER NOT NULL CHECK(size > 0),
        status TEXT NOT NULL CHECK(status IN ('pending', 'uploading', 'retry', 'uploaded')),
        upload_id TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        updated_at INTEGER NOT NULL
      )""",
    )
    database.execSQL("CREATE INDEX upload_queue_work ON upload_queue(status, next_attempt_at, captured_at)")
    database.execSQL("CREATE TABLE sync_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
  }

  override fun onUpgrade(database: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit

  fun enqueue(record: MediaRecord): Boolean {
    val values = ContentValues().apply {
      put("media_key", record.mediaKey)
      put("uri", record.uri)
      put("filename", record.filename)
      put("mime_type", record.mimeType)
      put("bucket_id", record.bucketId)
      put("captured_at", record.capturedAt)
      put("size", record.size)
      put("status", "pending")
      put("updated_at", System.currentTimeMillis())
    }
    return writableDatabase.insertWithOnConflict("upload_queue", null, values, SQLiteDatabase.CONFLICT_IGNORE) != -1L
  }

  fun claimNext(now: Long = System.currentTimeMillis()): UploadRecord? {
    val database = writableDatabase
    database.beginTransaction()
    try {
      val cursor = database.query(
        "upload_queue",
        null,
        "((status IN ('pending', 'retry') AND next_attempt_at <= ?) OR (status = 'uploading' AND updated_at <= ?))",
        arrayOf(now.toString(), (now - STALE_UPLOAD_MS).toString()),
        null,
        null,
        "captured_at ASC",
        "1",
      )
      val record = cursor.use { if (it.moveToFirst()) uploadRecord(it) else null } ?: return null
      val values = ContentValues().apply {
        put("status", "uploading")
        put("updated_at", now)
      }
      val changed = database.update("upload_queue", values, "media_key = ?", arrayOf(record.media.mediaKey))
      if (changed != 1) return null
      database.setTransactionSuccessful()
      return record
    } finally {
      database.endTransaction()
    }
  }

  fun saveUploadId(mediaKey: String, uploadId: String) = update(mediaKey, ContentValues().apply {
    put("upload_id", uploadId)
    put("updated_at", System.currentTimeMillis())
  })

  fun markUploaded(mediaKey: String) = update(mediaKey, ContentValues().apply {
    put("status", "uploaded")
    putNull("last_error")
    put("updated_at", System.currentTimeMillis())
  })

  fun markRetry(record: UploadRecord, message: String, retryAt: Long) = update(record.media.mediaKey, ContentValues().apply {
    put("status", "retry")
    put("attempts", record.attempts + 1)
    put("next_attempt_at", retryAt)
    put("last_error", message.take(1_000))
    put("updated_at", System.currentTimeMillis())
  })

  fun retryAuthenticationFailures() {
    writableDatabase.execSQL(
      "UPDATE upload_queue SET status = 'retry', next_attempt_at = 0, last_error = NULL WHERE status = 'retry' AND last_error LIKE 'Authentication failed:%'",
    )
  }

  fun counts(): Map<String, Any> {
    val counts = mutableMapOf("pending" to 0, "retry" to 0, "uploaded" to 0)
    readableDatabase.rawQuery("SELECT status, COUNT(*) AS total FROM upload_queue GROUP BY status", null).use { cursor ->
      while (cursor.moveToNext()) {
        val status = cursor.getString(0)
        val total = cursor.getInt(1)
        when (status) {
          "pending", "uploading" -> counts["pending"] = (counts["pending"] ?: 0) + total
          "retry" -> counts["retry"] = total
          "uploaded" -> counts["uploaded"] = total
        }
      }
    }
    return counts + mapOf(
      "lastRunAt" to (state("last_run_at")?.toLongOrNull() ?: 0L),
      "lastError" to (state("last_error") ?: ""),
    )
  }

  fun hasRunnableWork(now: Long = System.currentTimeMillis()): Boolean = readableDatabase.rawQuery(
    "SELECT 1 FROM upload_queue WHERE status = 'pending' OR (status = 'retry' AND next_attempt_at <= ?) OR (status = 'uploading' AND updated_at <= ?) LIMIT 1",
    arrayOf(now.toString(), (now - STALE_UPLOAD_MS).toString()),
  ).use { it.moveToFirst() }

  fun state(key: String): String? = readableDatabase.query(
    "sync_state",
    arrayOf("value"),
    "key = ?",
    arrayOf(key),
    null,
    null,
    null,
  ).use { if (it.moveToFirst()) it.getString(0) else null }

  fun setState(key: String, value: String) {
    val values = ContentValues().apply { put("key", key); put("value", value) }
    writableDatabase.insertWithOnConflict("sync_state", null, values, SQLiteDatabase.CONFLICT_REPLACE)
  }

  private fun update(mediaKey: String, values: ContentValues) {
    writableDatabase.update("upload_queue", values, "media_key = ?", arrayOf(mediaKey))
  }

  private fun uploadRecord(cursor: Cursor): UploadRecord = UploadRecord(
    media = MediaRecord(
      mediaKey = cursor.string("media_key"),
      uri = cursor.string("uri"),
      filename = cursor.string("filename"),
      mimeType = cursor.string("mime_type"),
      bucketId = cursor.string("bucket_id"),
      capturedAt = cursor.long("captured_at"),
      size = cursor.long("size"),
    ),
    uploadId = cursor.optionalString("upload_id"),
    attempts = cursor.int("attempts"),
  )

  private fun Cursor.string(column: String): String = getString(getColumnIndexOrThrow(column))
  private fun Cursor.optionalString(column: String): String? = getColumnIndexOrThrow(column).let { if (isNull(it)) null else getString(it) }
  private fun Cursor.long(column: String): Long = getLong(getColumnIndexOrThrow(column))
  private fun Cursor.int(column: String): Int = getInt(getColumnIndexOrThrow(column))

  private companion object {
    const val STALE_UPLOAD_MS = 60L * 60L * 1_000L
  }
}
