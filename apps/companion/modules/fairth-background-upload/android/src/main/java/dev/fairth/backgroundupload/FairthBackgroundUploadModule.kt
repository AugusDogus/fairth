package dev.fairth.backgroundupload

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class FairthBackgroundUploadModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("FairthBackgroundUpload")

    AsyncFunction("configure") { configurationJson: String, token: String ->
      val context = requireNotNull(appContext.reactContext) { "Android application context is unavailable." }
      val configuration = UploadConfiguration.parse(configurationJson)
      UploadConfiguration.save(context, configuration)
      SecureTokenStore(context).save(token)
      val database = UploadDatabaseProvider.get(context)
      val scanner = MediaScanner(context, database)
      database.retainBuckets(scanner.cameraBucketIds())
      database.retryAuthenticationFailures()
      UploadScheduler.configure(context, configuration)
    }

    AsyncFunction("runNow") {
      val context = requireNotNull(appContext.reactContext) { "Android application context is unavailable." }
      val configuration = UploadConfiguration.load(context) ?: error("Save upload settings before starting sync.")
      UploadScheduler.runNow(context, configuration)
    }

    AsyncFunction("enqueueManualAssets") { assetsJson: String ->
      val context = requireNotNull(appContext.reactContext) { "Android application context is unavailable." }
      val database = UploadDatabaseProvider.get(context)
      MediaScanner(context, database).enqueueManual(assetsJson)
    }

    AsyncFunction("enqueueSharedImages") { filesJson: String ->
      val context = requireNotNull(appContext.reactContext) { "Android application context is unavailable." }
      val configuration = UploadConfiguration.load(context)
        ?: error("Open Fairth and save its connection settings before sharing a photo.")
      require(SecureTokenStore(context).load() != null) { "Open Fairth and enroll this phone before sharing a photo." }
      val store = SharedMediaStore(context)
      val records = store.stage(filesJson)
      val database = UploadDatabaseProvider.get(context)
      val queued = records.count { record ->
        val accepted = database.enqueue(record)
        if (!accepted) store.deleteIfManaged(record.uri)
        accepted
      }
      if (queued > 0) UploadScheduler.runQueuedNow(context, configuration)
      queued
    }

    AsyncFunction("getStatus") {
      val context = requireNotNull(appContext.reactContext) { "Android application context is unavailable." }
      UploadConfiguration.load(context) ?: error("Save upload settings before reading upload status.")
      val database = UploadDatabaseProvider.get(context)
      database.counts(MediaScanner(context, database).eligibleCount())
    }

    AsyncFunction("getHistory") { limit: Int, offset: Int ->
      val context = requireNotNull(appContext.reactContext) { "Android application context is unavailable." }
      UploadConfiguration.load(context) ?: error("Save upload settings before reading upload history.")
      UploadDatabaseProvider.get(context).history(limit, offset)
    }

    AsyncFunction("retryUpload") { mediaKey: String ->
      val context = requireNotNull(appContext.reactContext) { "Android application context is unavailable." }
      val configuration = UploadConfiguration.load(context) ?: error("Save upload settings before retrying an upload.")
      val retried = UploadDatabaseProvider.get(context).retryNow(mediaKey)
      if (retried) UploadScheduler.runQueuedNow(context, configuration)
      retried
    }

    AsyncFunction("checkConnection") {
      val context = requireNotNull(appContext.reactContext) { "Android application context is unavailable." }
      val configuration = UploadConfiguration.load(context) ?: error("Save upload settings before checking connectivity.")
      IngestionClient(context.contentResolver).chooseEndpoint(configuration).endpoint != null
    }
  }
}
