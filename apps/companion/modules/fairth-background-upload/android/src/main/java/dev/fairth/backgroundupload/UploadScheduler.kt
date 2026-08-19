package dev.fairth.backgroundupload

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

internal object UploadScheduler {
  private const val PERIODIC_WORK = "fairth-background-upload-periodic"
  private const val IMMEDIATE_WORK = "fairth-background-upload-immediate"
  private const val FOLLOWUP_WORK = "fairth-background-upload-followup"

  fun configure(context: Context, configuration: UploadConfiguration) {
    val manager = WorkManager.getInstance(context)
    if (!configuration.automaticSync) {
      manager.cancelUniqueWork(PERIODIC_WORK)
      return
    }
    val request = PeriodicWorkRequestBuilder<FairthUploadWorker>(15, TimeUnit.MINUTES)
      .setConstraints(constraints(configuration))
      .build()
    manager.enqueueUniquePeriodicWork(PERIODIC_WORK, ExistingPeriodicWorkPolicy.UPDATE, request)
  }

  fun runNow(context: Context, configuration: UploadConfiguration) {
    val request = OneTimeWorkRequestBuilder<FairthUploadWorker>()
      .setConstraints(constraints(configuration))
      .build()
    WorkManager.getInstance(context).enqueueUniqueWork(IMMEDIATE_WORK, ExistingWorkPolicy.KEEP, request)
  }

  fun followUp(context: Context, configuration: UploadConfiguration) {
    val request = OneTimeWorkRequestBuilder<FairthUploadWorker>()
      .setInitialDelay(1, TimeUnit.MINUTES)
      .setConstraints(constraints(configuration))
      .build()
    WorkManager.getInstance(context).enqueueUniqueWork(FOLLOWUP_WORK, ExistingWorkPolicy.APPEND_OR_REPLACE, request)
  }

  private fun constraints(configuration: UploadConfiguration): Constraints = Constraints.Builder()
    .setRequiredNetworkType(if (configuration.wifiOnly) NetworkType.UNMETERED else NetworkType.CONNECTED)
    .setRequiresCharging(configuration.chargingOnly)
    .build()
}
