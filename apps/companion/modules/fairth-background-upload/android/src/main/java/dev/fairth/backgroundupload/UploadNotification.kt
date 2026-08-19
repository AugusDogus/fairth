package dev.fairth.backgroundupload

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.work.ForegroundInfo

internal object UploadNotification {
  private const val CHANNEL_ID = "fairth-background-uploads"
  private const val NOTIFICATION_ID = 0x4641

  fun foregroundInfo(context: Context, filename: String): ForegroundInfo {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, "Photo uploads", NotificationManager.IMPORTANCE_LOW).apply {
          description = "Shows when Fairth is actively transferring photos or videos."
        },
      )
    }
    val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
    val pendingIntent = launchIntent?.let {
      PendingIntent.getActivity(context, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
    val notification = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.stat_sys_upload)
      .setContentTitle("Fairth is uploading media")
      .setContentText(filename)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setProgress(0, 0, true)
      .apply { if (pendingIntent != null) setContentIntent(pendingIntent) }
      .build()
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      ForegroundInfo(NOTIFICATION_ID, notification, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    } else {
      ForegroundInfo(NOTIFICATION_ID, notification)
    }
  }
}
