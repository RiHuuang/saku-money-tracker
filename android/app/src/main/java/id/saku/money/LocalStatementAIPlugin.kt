package id.saku.money

import android.app.ActivityManager
import android.graphics.BitmapFactory
import android.os.Build
import android.os.StatFs
import android.util.Base64
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.ai.edge.litertlm.Backend
import com.google.ai.edge.litertlm.Conversation
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.EngineConfig
import com.google.ai.edge.litertlm.Message
import com.google.ai.edge.litertlm.MessageCallback
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import kotlinx.coroutines.runBlocking
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import kotlin.concurrent.thread

@CapacitorPlugin(name = "LocalStatementAI")
class LocalStatementAIPlugin : Plugin() {
    private val modelName = "qwen3_0_6b_mixed_int4.litertlm"
    private val modelBytes = 497_516_544L
    private val sha256 = "7900eb4e7362d88c58782c6f9999bb7a129e03544aa98b8f338ea0cc5d8c22c1"
    private val modelUrl = "https://huggingface.co/litert-community/Qwen3-0.6B/resolve/a3c5d805ae362dff7f580bc25f2dfb9a5a7eaa76/$modelName?download=true"
    private val modelFile get() = File(context.filesDir, "models/$modelName")
    private val cancelled = AtomicBoolean(false)
    private val working = AtomicBoolean(false)
    @Volatile private var connection: HttpURLConnection? = null
    @Volatile private var activeConversation: Conversation? = null

    private fun unsupportedReason(): String {
        if (Build.VERSION.SDK_INT < 31) return "Android 12 or newer is required"
        if (Build.SUPPORTED_64_BIT_ABIS.none { it == "arm64-v8a" }) return "A 64-bit ARM phone is required"
        val info = ActivityManager.MemoryInfo()
        (context.getSystemService(android.content.Context.ACTIVITY_SERVICE) as ActivityManager).getMemoryInfo(info)
        if (info.totalMem < 5_500_000_000L) return "A phone with at least 6 GB RAM is required"
        return ""
    }

    @PluginMethod
    fun getStatus(call: PluginCall) {
        val reason = unsupportedReason()
        val partial = File(modelFile.parentFile, "$modelName.part")
        if (!working.get() && partial.exists()) partial.delete()
        val free = StatFs(context.filesDir.path).availableBytes
        call.resolve(JSObject().apply {
            put("supported", reason.isEmpty())
            put("reason", reason)
            put("installed", modelFile.isFile && modelFile.length() == modelBytes)
            put("downloading", working.get())
            put("freeBytes", free)
            put("modelBytes", modelBytes)
        })
    }

    private fun progress(stage: String, bytes: Long = 0) {
        notifyListeners("modelProgress", JSObject().apply {
            put("stage", stage); put("bytes", bytes); put("total", modelBytes)
        })
    }

    @PluginMethod
    fun downloadModel(call: PluginCall) {
        if (unsupportedReason().isNotEmpty()) { call.reject(unsupportedReason()); return }
        if (modelFile.isFile && modelFile.length() == modelBytes) { call.resolve(); return }
        if (!working.compareAndSet(false, true)) { call.reject("Another model operation is running"); return }
        cancelled.set(false)
        thread(name = "saku-model-download") {
            val partial = File(modelFile.parentFile, "$modelName.part")
            try {
                if (StatFs(context.filesDir.path).availableBytes < modelBytes + 300_000_000L)
                    throw IllegalStateException("Need at least 800 MB of free storage")
                modelFile.parentFile?.mkdirs()
                partial.delete()
                connection = (URL(modelUrl).openConnection() as HttpURLConnection).apply {
                    connectTimeout = 20_000; readTimeout = 30_000; instanceFollowRedirects = true
                }
                val conn = connection!!
                conn.connect()
                if (conn.responseCode != 200) throw IllegalStateException("Model download returned HTTP ${conn.responseCode}")
                val digest = MessageDigest.getInstance("SHA-256")
                var count = 0L
                conn.inputStream.use { input -> partial.outputStream().buffered().use { output ->
                    val buffer = ByteArray(128 * 1024)
                    while (true) {
                        if (cancelled.get()) throw InterruptedException("Download cancelled")
                        val n = input.read(buffer)
                        if (n < 0) break
                        output.write(buffer, 0, n); digest.update(buffer, 0, n); count += n
                        if (count % (2 * 1024 * 1024) < buffer.size) progress("downloading", count)
                    }
                } }
                progress("verifying", count)
                if (count != modelBytes || digest.digest().joinToString("") { "%02x".format(it) } != sha256)
                    throw IllegalStateException("Model checksum failed; please retry")
                if (!partial.renameTo(modelFile)) throw IllegalStateException("Could not install model")
                progress("ready", count)
                call.resolve()
            } catch (e: Exception) {
                call.reject(e.message ?: "Model download failed", e)
            } finally {
                partial.delete(); connection?.disconnect(); connection = null; working.set(false)
            }
        }
    }

    @PluginMethod
    fun removeModel(call: PluginCall) {
        if (working.get()) { call.reject("Cancel the current operation first"); return }
        File(modelFile.parentFile, "$modelName.part").delete()
        if (modelFile.exists() && !modelFile.delete()) { call.reject("Could not remove model"); return }
        call.resolve()
    }

    @PluginMethod
    fun cancel(call: PluginCall) {
        cancelled.set(true)
        connection?.disconnect()
        try { activeConversation?.cancelProcess() } catch (_: Exception) { }
        call.resolve()
    }

    @PluginMethod
    fun recognizeImage(call: PluginCall) {
        val encoded = call.getString("image") ?: run { call.reject("Image is required"); return }
        try {
            val bytes = Base64.decode(encoded, Base64.DEFAULT)
            val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                ?: throw IllegalArgumentException("Cannot decode page image")
            val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
            recognizer.process(InputImage.fromBitmap(bitmap, 0))
                .addOnSuccessListener { result -> call.resolve(JSObject().apply { put("text", result.text) }) }
                .addOnFailureListener { call.reject(it.message ?: "OCR failed", it) }
                .addOnCompleteListener { bitmap.recycle(); recognizer.close() }
        } catch (e: Exception) { call.reject(e.message ?: "OCR failed", e) }
    }

    @PluginMethod
    fun generate(call: PluginCall) {
        val prompt = call.getString("prompt") ?: run { call.reject("Prompt is required"); return }
        if (prompt.length > 7_000) { call.reject("Statement chunk is too large"); return }
        if (!modelFile.isFile || modelFile.length() != modelBytes) { call.reject("Download the model first"); return }
        if (!working.compareAndSet(false, true)) { call.reject("Another model operation is running"); return }
        cancelled.set(false)
        thread(name = "saku-model-inference") {
            try {
                var answer: String? = null
                var used = ""
                var gpuError: Exception? = null
                for ((label, backend) in listOf("GPU" to Backend.GPU(), "CPU" to Backend.CPU())) {
                    if (cancelled.get()) throw InterruptedException("Processing cancelled")
                    try {
                        progress("loading $label")
                        runBlocking {
                            Engine(EngineConfig(modelPath = modelFile.path, backend = backend, cacheDir = context.cacheDir.path)).use { engine ->
                                engine.initialize()
                                engine.createConversation().use { conversation ->
                                    activeConversation = conversation
                                    try {
                                        progress("extracting")
                                        val chunks = StringBuffer()
                                        val failure = AtomicReference<Throwable?>(null)
                                        val done = CountDownLatch(1)
                                        conversation.sendMessageAsync(prompt, object : MessageCallback {
                                            override fun onMessage(message: Message) { chunks.append(message.toString()) }
                                            override fun onDone() { done.countDown() }
                                            override fun onError(throwable: Throwable) { failure.set(throwable); done.countDown() }
                                        }, maxOutputToken = 1024)
                                        if (!done.await(10, TimeUnit.MINUTES)) {
                                            conversation.cancelProcess()
                                            throw IllegalStateException("Model processing timed out")
                                        }
                                        failure.get()?.let { throw it }
                                        answer = chunks.toString()
                                    } finally {
                                        activeConversation = null
                                    }
                                }
                            }
                        }
                        used = label
                        break
                    } catch (e: Exception) {
                        if (label == "CPU") throw IllegalStateException("GPU and CPU inference failed: ${e.message}", e)
                        gpuError = e
                    }
                }
                if (cancelled.get()) throw InterruptedException("Processing cancelled")
                if (answer == null) throw IllegalStateException(gpuError?.message ?: "Model returned no response")
                call.resolve(JSObject().apply { put("text", answer); put("backend", used) })
            } catch (e: Exception) { call.reject(e.message ?: "Model processing failed", e) }
            finally { activeConversation = null; working.set(false) }
        }
    }
}
