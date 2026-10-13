package com.laolao.classcalendar.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Login tokens encrypted by Android Keystore. Uses the same alias and file as the old app,
 * so an in-place update keeps the user signed in.
 */
object SecretBox {
    private const val ALIAS = "campus_session_v4"
    private const val FILE = "campus_auth_v4"

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        if (!ks.containsAlias(ALIAS)) {
            KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
                init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
                generateKey()
            }
        }
        return ks.getKey(ALIAS, null) as SecretKey
    }

    fun write(c: Context, text: String?) {
        val p = c.getSharedPreferences(FILE, 0)
        if (text == null) { p.edit().clear().commit(); return }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        val v = Base64.encodeToString(cipher.iv, Base64.NO_WRAP) + ":" +
            Base64.encodeToString(cipher.doFinal(text.toByteArray()), Base64.NO_WRAP)
        if (!p.edit().putString("session", v).commit()) throw java.io.IOException("登录信息未保存，请检查手机存储")
    }

    fun read(c: Context): String? {
        val s = c.getSharedPreferences(FILE, 0).getString("session", null) ?: return null
        val a = s.split(":", limit = 2)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(a[0], Base64.NO_WRAP)))
        return String(cipher.doFinal(Base64.decode(a[1], Base64.NO_WRAP)))
    }
}

/** Server-calibrated clock so a wrong phone clock cannot decide sync conflicts. */
object TrustedClock {
    private var serverMillis = 0L
    private var sampledNanos = 0L
    @Synchronized fun calibrate(server: Long, requestMillis: Long) {
        if (server <= 0 || requestMillis !in 0..30000) return
        serverMillis = server + requestMillis / 2
        sampledNanos = System.nanoTime()
    }
    @Synchronized fun now(): Long =
        if (serverMillis == 0L) System.currentTimeMillis()
        else serverMillis + (System.nanoTime() - sampledNanos) / 1_000_000
}
