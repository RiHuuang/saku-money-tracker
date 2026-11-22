package id.saku.money

import android.graphics.BitmapFactory
import android.util.Base64
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import java.io.File
import kotlin.concurrent.thread

// On-device text recognition for receipts and scanned statement pages (ML Kit).
// The old local language model was never reachable and has been removed.
@CapacitorPlugin(name = "LocalStatementAI")
class LocalStatementAIPlugin : Plugin() {
    override fun load() {
        // Free the space a model downloaded by an older build may still use (about 475 MB).
        val models = File(context.filesDir, "models")
        if (models.exists()) thread(name = "saku-model-cleanup") { models.deleteRecursively() }
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
}
