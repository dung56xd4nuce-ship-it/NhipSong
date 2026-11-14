package vn.nhipsong.app.siwc;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Lưu thông tin xác thực bằng khóa AES-GCM trong Android Keystore (không xuất được khỏi thiết bị). */
public final class KeystoreSecretStore implements SiwcCore.SecretStore {
    private static final String ALIAS = "nhip_siwc_key";
    private static final String FILE = "nhip_siwc_secure";
    private static final String KEY = "conn";
    private final SharedPreferences prefs;

    public KeystoreSecretStore(Context ctx) { prefs = ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE); }

    private SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (ks.containsAlias(ALIAS)) return ((KeyStore.SecretKeyEntry) ks.getEntry(ALIAS, null)).getSecretKey();
        KeyGenerator g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        g.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build());
        return g.generateKey();
    }

    @Override public synchronized String load() {
        String v = prefs.getString(KEY, null);
        if (v == null) return null;
        try {
            String[] p = v.split(":", 2);
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(p[0], Base64.NO_WRAP)));
            return new String(c.doFinal(Base64.decode(p[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
        } catch (Exception e) {
            // Khóa bị mất (đổi khóa màn hình, khôi phục máy…) ⇒ coi như cần kết nối lại
            clear();
            return null;
        }
    }

    @Override public synchronized void save(String json) {
        try {
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, key());
            String v = Base64.encodeToString(c.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(c.doFinal(json.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
            if (!prefs.edit().putString(KEY, v).commit()) throw new IllegalStateException("Không ghi được kho bảo mật");
        } catch (Exception e) {
            throw new IllegalStateException("Không ghi được kho bảo mật");
        }
    }

    @Override public synchronized void clear() { prefs.edit().remove(KEY).commit(); }
}
