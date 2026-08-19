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
      UploadDatabase(context).use { it.retryAuthenticationFailures() }
      UploadScheduler.configure(context, configuration)
    }

    AsyncFunction("runNow") {
      val context = requireNotNull(appContext.reactContext) { "Android application context is unavailable." }
      val configuration = UploadConfiguration.load(context) ?: error("Save upload settings before starting sync.")
      UploadScheduler.runNow(context, configuration)
    }

    AsyncFunction("enqueueManualAssets") { assetsJson: String ->
      val context = requireNotNull(appContext.reactContext) { "Android application context is unavailable." }
      UploadDatabase(context).use { database -> MediaScanner(context, database).enqueueManual(assetsJson) }
    }

    AsyncFunction("getStatus") {
      val context = requireNotNull(appContext.reactContext) { "Android application context is unavailable." }
      UploadDatabase(context).use { it.counts() }
    }
  }
}
