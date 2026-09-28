package id.saku.money

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.AuthorizationResult
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.common.api.Scope

class GoogleAuthorizationActivity : Activity() {
    companion object {
        const val CODE = "authorizationCode"
        const val ERROR = "authorizationError"
        private const val REQUEST_AUTHORIZATION = 4312
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (savedInstanceState != null) return
        val request = AuthorizationRequest.builder()
            .setRequestedScopes(listOf(
                Scope("openid"), Scope("email"), Scope("profile"),
                Scope("https://www.googleapis.com/auth/drive.file")
            ))
            .requestOfflineAccess(BuildConfig.SAKU_GOOGLE_WEB_CLIENT_ID, true)
            .build()
        Identity.getAuthorizationClient(this).authorize(request)
            .addOnSuccessListener { result ->
                if (result.hasResolution()) {
                    try { startIntentSenderForResult(result.pendingIntent!!.intentSender, REQUEST_AUTHORIZATION, null, 0, 0, 0) }
                    catch (e: Exception) { fail(e.message ?: "Could not open Google sign-in") }
                } else finishWith(result)
            }
            .addOnFailureListener { fail(it.message ?: "Google sign-in failed") }
    }

    @Deprecated("Required by Google AuthorizationClient PendingIntent")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQUEST_AUTHORIZATION) return
        if (resultCode != RESULT_OK || data == null) { fail("Google sign-in was cancelled"); return }
        try { finishWith(Identity.getAuthorizationClient(this).getAuthorizationResultFromIntent(data)) }
        catch (e: ApiException) { fail(e.message ?: "Google authorization failed") }
    }

    private fun finishWith(result: AuthorizationResult) {
        val code = result.serverAuthCode
        if (code.isNullOrBlank()) { fail("Google did not return offline access"); return }
        setResult(RESULT_OK, Intent().putExtra(CODE, code))
        finish()
    }
    private fun fail(message: String) {
        setResult(RESULT_CANCELED, Intent().putExtra(ERROR, message))
        finish()
    }
}
