package dev.fairth.backgroundupload

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import java.io.IOException

internal class FairthUploadWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
  override suspend fun doWork(): Result {
    val configuration = UploadConfiguration.load(applicationContext)
      ?: return Result.failure(message("Fairth has not been configured yet."))
    if (!configuration.isWithinWindow()) return Result.success(message("Waiting for the configured sync window."))
    val token = SecureTokenStore(applicationContext).load()
      ?: return Result.failure(message("This phone must be enrolled before background uploads can run."))
    val database = UploadDatabase(applicationContext)
    val startedAt = System.currentTimeMillis()
    return try {
      val scan = MediaScanner(applicationContext, database).scan(configuration)
      val client = IngestionClient(applicationContext.contentResolver)
      val endpoint = client.chooseEndpoint(configuration)
      if (endpoint == null) {
        recordRun(database, "Neither the LAN nor remote ingestion endpoint is reachable.")
        return Result.retry()
      }
      var uploaded = 0
      while (uploaded < MAX_UPLOADS_PER_RUN && System.currentTimeMillis() - startedAt < MAX_RUN_MS) {
        val record = database.claimNext() ?: break
        setForeground(UploadNotification.foregroundInfo(applicationContext, record.media.filename))
        try {
          client.upload(endpoint, token, configuration, record) { uploadId -> database.saveUploadId(record.media.mediaKey, uploadId) }
          database.markUploaded(record.media.mediaKey)
          uploaded += 1
        } catch (failure: UploadFailure) {
          val prefix = if (failure.authenticationFailed) "Authentication failed: " else "Upload failed: "
          val detail = failure.message ?: "The upload failed for an unknown reason."
          database.markRetry(record, prefix + detail, nextRetry(record.attempts, failure.authenticationFailed))
          recordRun(database, prefix + detail)
          if (failure.authenticationFailed) return Result.failure(message(prefix + detail))
          return Result.retry()
        } catch (failure: IOException) {
          val detail = "Upload failed: ${failure.message ?: "The network connection ended unexpectedly."}"
          database.markRetry(record, detail, nextRetry(record.attempts, false))
          recordRun(database, detail)
          return Result.retry()
        }
      }
      recordRun(database, null)
      if (scan.hasMore || database.hasRunnableWork()) UploadScheduler.followUp(applicationContext, configuration)
      Result.success(message("Queued ${scan.queued} and uploaded $uploaded media items."))
    } catch (failure: SecurityException) {
      val detail = "Photo access is unavailable. Open Fairth and grant photo and video permission; existing queue state remains intact."
      recordRun(database, detail)
      Result.failure(message(detail))
    } catch (failure: Exception) {
      val detail = "Background sync failed: ${failure.message ?: "unknown Android error"}. Existing queue state remains intact."
      recordRun(database, detail)
      Result.retry()
    } finally {
      database.close()
    }
  }

  private fun nextRetry(attempts: Int, authenticationFailed: Boolean): Long {
    if (authenticationFailed) return System.currentTimeMillis() + TimeUnitHours.DAY
    val exponent = minOf(attempts + 1, 10)
    return System.currentTimeMillis() + minOf(TimeUnitHours.SIX, 15_000L * (1L shl exponent))
  }

  private fun recordRun(database: UploadDatabase, error: String?) {
    database.setState("last_run_at", System.currentTimeMillis().toString())
    database.setState("last_error", error.orEmpty())
  }

  private fun message(value: String) = androidx.work.workDataOf("message" to value)

  private object TimeUnitHours {
    const val SIX = 6L * 60L * 60L * 1_000L
    const val DAY = 24L * 60L * 60L * 1_000L
  }

  private companion object {
    const val MAX_UPLOADS_PER_RUN = 20
    const val MAX_RUN_MS = 8L * 60L * 1_000L
  }
}
