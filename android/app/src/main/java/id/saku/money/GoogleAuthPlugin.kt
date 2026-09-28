package id.saku.money

import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.activity.result.ActivityResult
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

@CapacitorPlugin(name = "GoogleAuth")
class GoogleAuthPlugin : Plugin() {
    private val prefs by lazy { context.getSharedPreferences("saku_secure_session", Context.MODE_PRIVATE) }
    private val alias = "saku_session_key"

    @PluginMethod
    fun isConfigured(call: PluginCall) {
        call.resolve(JSObject().apply {
            put("configured", BuildConfig.SAKU_GOOGLE_WEB_CLIENT_ID.isNotBlank())
            put("deviceSecure", (context.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager).isDeviceSecure)
        })
    }

    @PluginMethod
    fun authorize(call: PluginCall) {
        if (BuildConfig.SAKU_GOOGLE_WEB_CLIENT_ID.isBlank()) {
            call.reject("Google sign-in is not configured in this build")
            return
        }
        startActivityForResult(call, Intent(context, GoogleAuthorizationActivity::class.java), "authorizationResult")
    }

    @ActivityCallback
    private fun authorizationResult(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        val code = result.data?.getStringExtra(GoogleAuthorizationActivity.CODE)
        if (result.resultCode != android.app.Activity.RESULT_OK || code.isNullOrBlank()) {
            call.reject(result.data?.getStringExtra(GoogleAuthorizationActivity.ERROR) ?: "Google sign-in was cancelled")
            return
        }
        call.resolve(JSObject().apply { put("code", code) })
    }

    @PluginMethod
    fun saveSession(call: PluginCall) {
        val access = call.getString("accessToken") ?: ""
        val refresh = call.getString("refreshToken") ?: ""
        if (access.isBlank() || refresh.isBlank()) { call.reject("Session tokens are required"); return }
        try { prefs.edit().putString("tokens", encrypt("$access\n$refresh")).apply(); call.resolve() }
        catch (e: Exception) { call.reject("Could not secure the session", e) }
    }

    @PluginMethod
    fun getSession(call: PluginCall) {
        try {
            val value = prefs.getString("tokens", null)
            if (value == null) { call.resolve(JSObject().apply { put("signedIn", false) }); return }
            val parts = decrypt(value).split("\n", limit = 2)
            if (parts.size != 2) throw IllegalStateException("Invalid session")
            call.resolve(JSObject().apply { put("signedIn", true); put("accessToken", parts[0]); put("refreshToken", parts[1]) })
        } catch (_: Exception) {
            prefs.edit().clear().apply()
            call.resolve(JSObject().apply { put("signedIn", false) })
        }
    }

    @PluginMethod
    fun clearSession(call: PluginCall) { prefs.edit().clear().apply(); call.resolve() }

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        return generator.generateKey()
    }
    private fun encrypt(plain: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        return Base64.encodeToString(cipher.iv + cipher.doFinal(plain.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
    }
    private fun decrypt(encoded: String): String {
        val bytes = Base64.decode(encoded, Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12))) }
        return String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8)
    }
}
