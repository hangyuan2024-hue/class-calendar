package com.laolao.classcalendar;

import android.content.Context;
import android.security.keystore.*;
import android.util.Base64;
import java.security.KeyStore;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;

/** Access and refresh tokens stay in Android Keystore encrypted storage, outside exports. */
final class CampusSecret {
  private static final String ALIAS = "campus_session_v4";

  private static javax.crypto.SecretKey key() throws Exception {
    KeyStore store = KeyStore.getInstance("AndroidKeyStore");
    store.load(null);
    if (!store.containsAlias(ALIAS)) {
      KeyGenerator gen =
          KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
      gen.init(
          new KeyGenParameterSpec.Builder(
                  ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
              .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
              .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
              .build());
      gen.generateKey();
    }
    return (javax.crypto.SecretKey) store.getKey(ALIAS, null);
  }

  static void write(Context c, String text) throws Exception {
    if (text == null) {
      c.getSharedPreferences("campus_auth_v4", 0).edit().clear().commit();
      return;
    }
    Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
    cipher.init(Cipher.ENCRYPT_MODE, key());
    String v =
        Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP)
            + ":"
            + Base64.encodeToString(cipher.doFinal(text.getBytes("UTF-8")), Base64.NO_WRAP);
    if (!c.getSharedPreferences("campus_auth_v4", 0).edit().putString("session", v).commit())
      throw new java.io.IOException("登录信息未保存，请检查设备存储");
  }

  static String read(Context c) throws Exception {
    String s = c.getSharedPreferences("campus_auth_v4", 0).getString("session", null);
    if (s == null) return null;
    String[] a = s.split(":", 2);
    Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
    cipher.init(
        Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(a[0], Base64.NO_WRAP)));
    return new String(cipher.doFinal(Base64.decode(a[1], Base64.NO_WRAP)), "UTF-8");
  }
}
