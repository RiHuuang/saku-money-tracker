package id.saku.money

import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import androidx.activity.result.ActivityResult
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "GoogleAuth")
class GoogleAuthPlugin : Plugin() {
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

    @PluginMethod
    fun authorizeDrive(call: PluginCall) {
        if (BuildConfig.SAKU_GOOGLE_WEB_CLIENT_ID.isBlank()) {
            call.reject("Google sign-in is not configured in this build")
            return
        }
        startActivityForResult(call, Intent(context, GoogleAuthorizationActivity::class.java).putExtra(GoogleAuthorizationActivity.DRIVE, true), "authorizationResult")
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
        try { SecureSessionStore.save(context, SessionTokens(access, refresh)); call.resolve() }
        catch (e: Exception) { call.reject("Could not secure the session", e) }
    }

    @PluginMethod
    fun getSession(call: PluginCall) {
        try {
            val tokens = SecureSessionStore.load(context)
            if (tokens == null) { call.resolve(JSObject().apply { put("signedIn", false) }); return }
            call.resolve(JSObject().apply { put("signedIn", true); put("accessToken", tokens.accessToken); put("refreshToken", tokens.refreshToken) })
        } catch (_: Exception) {
            SecureSessionStore.clear(context)
            call.resolve(JSObject().apply { put("signedIn", false) })
        }
    }

    @PluginMethod
    fun clearSession(call: PluginCall) {
        WidgetCloudSync.cancel(context)
        SecureSessionStore.clear(context)
        call.resolve()
    }
}
