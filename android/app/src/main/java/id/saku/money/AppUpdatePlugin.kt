package id.saku.money

import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

@CapacitorPlugin(name = "AppUpdate")
class AppUpdatePlugin : Plugin() {
    @Volatile private var cancelled = false
    @Volatile private var connection: HttpURLConnection? = null

    @PluginMethod
    fun getStatus(call: PluginCall) {
        call.resolve(JSObject().apply {
            put("versionCode", BuildConfig.VERSION_CODE)
            put("versionName", BuildConfig.VERSION_NAME)
            put("metered", (context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager).isActiveNetworkMetered)
            put("canInstallPackages", Build.VERSION.SDK_INT < Build.VERSION_CODES.O || context.packageManager.canRequestPackageInstalls())
        })
    }

    @PluginMethod
    fun cancel(call: PluginCall) {
        cancelled = true
        connection?.disconnect()
        call.resolve()
    }

    @PluginMethod
    fun downloadAndInstall(call: PluginCall) {
        val url = call.getString("url") ?: ""
        val expectedBytes = call.getLong("bytes") ?: -1L
        val expectedHash = call.getString("sha256")?.lowercase() ?: ""
        val expectedVersion = call.getInt("versionCode") ?: -1
        val allowMetered = call.getBoolean("allowMetered") ?: false
        val base = runCatching { URL(BuildConfig.SAKU_API_URL) }.getOrNull()
        val target = runCatching { URL(url) }.getOrNull()
        if (base == null || target == null || target.protocol != "https" || target.host != base.host || expectedBytes !in 1..200_000_000 || !expectedHash.matches(Regex("[a-f0-9]{64}")) || expectedVersion <= BuildConfig.VERSION_CODE) {
            call.reject("Invalid Saku update metadata", "INVALID_UPDATE")
            return
        }
        val metered = (context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager).isActiveNetworkMetered
        if (metered && !allowMetered) {
            call.reject("This download uses a metered connection", "METERED_CONFIRMATION_REQUIRED")
            return
        }
        cancelled = false
        Thread {
            val directory = File(context.cacheDir, "updates").apply { mkdirs() }
            val apk = File(directory, "saku-$expectedVersion.apk")
            try {
                directory.listFiles()?.filter { it != apk }?.forEach { it.delete() }
                download(target, apk, expectedBytes)
                if (cancelled) throw InterruptedException("Download cancelled")
                val actualHash = sha256(apk)
                if (actualHash != expectedHash) throw IllegalStateException("The downloaded update did not pass its integrity check")
                verifyArchive(apk, expectedVersion)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !context.packageManager.canRequestPackageInstalls()) {
                    bridge.activity.runOnUiThread {
                        bridge.activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}")))
                    }
                    call.resolve(JSObject().put("status", "permissionRequired"))
                    return@Thread
                }
                bridge.activity.runOnUiThread {
                    val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", apk)
                    bridge.activity.startActivity(Intent(Intent.ACTION_VIEW).apply {
                        setDataAndType(uri, "application/vnd.android.package-archive")
                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                    })
                    call.resolve(JSObject().put("status", "installerOpened"))
                }
            } catch (_: InterruptedException) {
                apk.delete()
                call.reject("Update download cancelled", "CANCELLED")
            } catch (error: Exception) {
                apk.delete()
                call.reject(error.message ?: "Could not install the update", "UPDATE_FAILED", error)
            } finally {
                connection = null
            }
        }.start()
    }

    private fun download(url: URL, destination: File, expectedBytes: Long) {
        val request = (url.openConnection() as HttpURLConnection).apply {
            connectTimeout = 15_000
            readTimeout = 60_000
            instanceFollowRedirects = false
            setRequestProperty("Accept", "application/vnd.android.package-archive")
        }
        connection = request
        try {
            if (request.responseCode != 200) throw IllegalStateException("Saku update download failed (${request.responseCode})")
            val declared = request.contentLengthLong
            if (declared != expectedBytes) throw IllegalStateException("The update size does not match its release information")
            var received = 0L
            request.inputStream.use { input ->
                FileOutputStream(destination).use { output ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        if (cancelled) throw InterruptedException("Download cancelled")
                        val count = input.read(buffer)
                        if (count < 0) break
                        received += count
                        if (received > expectedBytes) throw IllegalStateException("The update is larger than expected")
                        output.write(buffer, 0, count)
                        notifyListeners("downloadProgress", JSObject().apply { put("bytes", received); put("total", expectedBytes) })
                    }
                }
            }
            if (received != expectedBytes) throw IllegalStateException("The update download was incomplete")
        } finally { request.disconnect() }
    }

    private fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                digest.update(buffer, 0, count)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    @Suppress("DEPRECATION")
    private fun packageInfo(path: String): PackageInfo? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        context.packageManager.getPackageArchiveInfo(path, PackageManager.PackageInfoFlags.of(PackageManager.GET_SIGNING_CERTIFICATES.toLong()))
    } else context.packageManager.getPackageArchiveInfo(path, if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES)

    @Suppress("DEPRECATION")
    private fun installedInfo(): PackageInfo = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        context.packageManager.getPackageInfo(context.packageName, PackageManager.PackageInfoFlags.of(PackageManager.GET_SIGNING_CERTIFICATES.toLong()))
    } else context.packageManager.getPackageInfo(context.packageName, if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES)

    @Suppress("DEPRECATION")
    private fun signerHashes(info: PackageInfo): Set<String> {
        val signatures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.signingInfo?.apkContentsSigners else info.signatures
        return signatures.orEmpty().map { signature -> MessageDigest.getInstance("SHA-256").digest(signature.toByteArray()).joinToString("") { "%02x".format(it) } }.toSet()
    }

    @Suppress("DEPRECATION")
    private fun verifyArchive(apk: File, expectedVersion: Int) {
        val archive = packageInfo(apk.absolutePath) ?: throw IllegalStateException("Android could not read the downloaded update")
        if (archive.packageName != context.packageName) throw IllegalStateException("The update belongs to a different app")
        val archiveVersion = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) archive.longVersionCode else archive.versionCode.toLong()
        if (archiveVersion != expectedVersion.toLong()) throw IllegalStateException("The update version does not match its release information")
        val archiveSigners = signerHashes(archive)
        val installedSigners = signerHashes(installedInfo())
        if (archiveSigners.isEmpty() || archiveSigners != installedSigners) throw IllegalStateException("The update signature does not match this Saku installation")
    }
}
