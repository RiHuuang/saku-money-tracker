package id.saku.money

import android.content.Context
import android.view.WindowManager
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONObject

object AppLockSettings {
    private const val KEY = "saku-app-lock-v1"
    fun enabled(context: Context): Boolean = context.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE).getString(KEY, null)
        ?.let { runCatching { JSONObject(it).optBoolean("enabled", false) }.getOrDefault(false) } ?: false
}

@CapacitorPlugin(name = "AppLock")
class AppLockPlugin : Plugin() {
    private val authenticators = BIOMETRIC_STRONG or DEVICE_CREDENTIAL

    @PluginMethod
    fun status(call: PluginCall) {
        val result = BiometricManager.from(context).canAuthenticate(authenticators)
        call.resolve(JSObject().apply {
            put("available", result == BiometricManager.BIOMETRIC_SUCCESS)
            put("reason", when (result) {
                BiometricManager.BIOMETRIC_SUCCESS -> ""
                BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED -> "none_enrolled"
                BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE, BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE -> "unavailable"
                else -> "unsupported"
            })
        })
    }

    @PluginMethod
    fun authenticate(call: PluginCall) {
        val title = call.getString("title") ?: "Unlock Saku"
        activity.runOnUiThread {
            val prompt = BiometricPrompt(activity, ContextCompat.getMainExecutor(context), object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    call.resolve(JSObject().apply { put("authenticated", true) })
                }
                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    // Cancel, lockout and dismissal all leave the app locked; the lock screen offers a retry.
                    call.resolve(JSObject().apply { put("authenticated", false); put("message", errString.toString()) })
                }
            })
            runCatching {
                prompt.authenticate(BiometricPrompt.PromptInfo.Builder().setTitle(title).setAllowedAuthenticators(authenticators).build())
            }.onFailure { call.resolve(JSObject().apply { put("authenticated", false); put("message", it.message ?: "Authentication is unavailable") }) }
        }
    }

    @PluginMethod
    fun setSecure(call: PluginCall) {
        val secure = call.getBoolean("secure") ?: false
        activity.runOnUiThread {
            if (secure) activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
            else activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
            call.resolve()
        }
    }
}
