package dev.fairth.backgroundupload

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

internal class SecureTokenStore(private val context: Context) {
  private val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

  fun save(token: String) {
    require(token.isNotBlank()) { "The enrolled device token cannot be empty." }
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.ENCRYPT_MODE, key())
    val encrypted = cipher.doFinal(token.toByteArray(Charsets.UTF_8))
    val stored = ByteArray(cipher.iv.size + encrypted.size)
    cipher.iv.copyInto(stored)
    encrypted.copyInto(stored, cipher.iv.size)
    preferences.edit().putString(TOKEN, Base64.encodeToString(stored, Base64.NO_WRAP)).apply()
  }

  fun load(): String? {
    val encoded = preferences.getString(TOKEN, null) ?: return null
    return runCatching {
      val stored = Base64.decode(encoded, Base64.NO_WRAP)
      require(stored.size > IV_LENGTH)
      val cipher = Cipher.getInstance(TRANSFORMATION)
      cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, stored, 0, IV_LENGTH))
      String(cipher.doFinal(stored, IV_LENGTH, stored.size - IV_LENGTH), Charsets.UTF_8)
    }.getOrNull()
  }

  private fun key(): SecretKey {
    val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    val existing = keyStore.getKey(KEY_ALIAS, null)
    if (existing is SecretKey) return existing
    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
      init(
        KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
          .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
          .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
          .build(),
      )
      generateKey()
    }
  }

  private companion object {
    const val PREFERENCES = "fairth-background-upload-secrets"
    const val TOKEN = "bearer-token"
    const val KEY_ALIAS = "fairth-background-upload-token"
    const val TRANSFORMATION = "AES/GCM/NoPadding"
    const val IV_LENGTH = 12
  }
}
