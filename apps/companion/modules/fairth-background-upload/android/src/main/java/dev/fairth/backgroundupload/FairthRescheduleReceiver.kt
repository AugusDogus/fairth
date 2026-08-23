package dev.fairth.backgroundupload

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class FairthRescheduleReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
    val configuration = UploadConfiguration.load(context) ?: return
    UploadScheduler.configure(context, configuration)
  }
}
