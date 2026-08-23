package dev.fairth.backgroundupload

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.ForegroundInfo
import androidx.work.WorkerParameters
import java.io.IOException
import kotlinx.coroutines.sync.Mutex

internal class FairthUploadWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
  override suspend fun doWork(): Result {
    if (!workMutex.tryLock()) return Result.success(message("Another Fairth upload is already running."))
    return try {
      runWork()
    } finally {
      try {
        UploadDatabaseProvider.get(applicationContext).recoverInterruptedUploads()
      } finally {
        workMutex.unlock()
      }
    }
  }

  private suspend fun runWork(): Result {
    val configuration = UploadConfiguration.load(applicationContext)
      ?: return Result.failure(message("Fairth has not been configured yet."))
    val scanMedia = inputData.getBoolean(SCAN_MEDIA, true)
    if (scanMedia && !configuration.isWithinWindow()) return Result.success(message("Waiting for the configured sync window."))
    val token = SecureTokenStore(applicationContext).load()
      ?: return Result.failure(message("This phone must be enrolled before background uploads can run."))
    val database = UploadDatabaseProvider.get(applicationContext)
    val foregroundAvailable = trySetForeground(UploadNotification.preparingInfo(applicationContext))
    val startedAt = System.currentTimeMillis()
    return try {
      val scan = if (scanMedia) {
        val scanner = MediaScanner(applicationContext, database)
        database.retainBuckets(scanner.cameraBucketIds())
        scanner.scan()
      } else {
        ScanResult(queued = 0, hasMore = false, eligible = 0)
      }
      val client = IngestionClient(applicationContext.contentResolver)
      val endpointChoice = client.chooseEndpoint(configuration)
      val endpoint = endpointChoice.endpoint
      if (endpoint == null) {
        recordRun(database, "The Fairth ingestion endpoint is unreachable: ${endpointChoice.error}")
        return Result.retry()
      }
      client.heartbeat(endpoint, token)
      var uploaded = 0
      var lastNotificationAt = 0L
      while (System.currentTimeMillis() - startedAt < MAX_RUN_MS) {
        val record = database.claimNext() ?: break
        val notificationAt = System.currentTimeMillis()
        if (foregroundAvailable && (lastNotificationAt == 0L || notificationAt - lastNotificationAt >= NOTIFICATION_INTERVAL_MS)) {
          val progress = database.queueCounts()
          setForeground(
            UploadNotification.foregroundInfo(
              applicationContext,
              record.media.filename,
              progress.uploaded,
              maxOf(scan.eligible, progress.total),
            ),
          )
          lastNotificationAt = notificationAt
        }
        try {
          client.upload(endpoint, token, configuration, record) { uploadId -> database.saveUploadId(record.media.mediaKey, uploadId) }
          database.markUploaded(record.media.mediaKey)
          SharedMediaStore(applicationContext).deleteIfManaged(record.media.uri)
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
      if (scan.hasMore || database.hasRunnableWork()) UploadScheduler.followUp(applicationContext, configuration, scanMedia)
      Result.success(message("Queued ${scan.queued} and uploaded $uploaded media items."))
    } catch (failure: SecurityException) {
      val detail = if (scanMedia) {
        "Photo access is unavailable. Open Fairth and grant photo and video permission; existing queue state remains intact."
      } else {
        "A queued shared photo is no longer readable. Share it to Fairth again; the rest of the queue remains intact."
      }
      recordRun(database, detail)
      Result.failure(message(detail))
    } catch (failure: Exception) {
      val detail = "Background sync failed: ${failure.message ?: "unknown Android error"}. Existing queue state remains intact."
      recordRun(database, detail)
      Result.retry()
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

  private suspend fun trySetForeground(info: ForegroundInfo): Boolean = try {
    setForeground(info)
    true
  } catch (_: IllegalStateException) {
    // Android can wake scheduled work while still denying a foreground-service
    // launch. The JobScheduler execution window already permits this work.
    false
  }

  private fun message(value: String) = androidx.work.workDataOf("message" to value)

  private object TimeUnitHours {
    const val SIX = 6L * 60L * 60L * 1_000L
    const val DAY = 24L * 60L * 60L * 1_000L
  }

  companion object {
    internal const val SCAN_MEDIA = "scan_media"
    const val MAX_RUN_MS = 8L * 60L * 1_000L
    const val NOTIFICATION_INTERVAL_MS = 1_000L
    val workMutex = Mutex()
  }
}
