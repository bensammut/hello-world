package com.bensammut.pixelmill

import android.app.Activity
import android.content.ContentValues
import android.provider.MediaStore
import android.util.Base64
import android.webkit.JavascriptInterface
import android.widget.Toast

/**
 * Exposed to the web app as `window.PixelMillNative` (see src/native/bridge.ts).
 * JavascriptInterface methods run on a WebView background thread.
 */
class NativeBridge(
    private val activity: Activity,
    private val pendant: PendantBle,
    private val glyph: GlyphMatrix,
) {
    @JavascriptInterface
    fun pendantConnect() = activity.runOnUiThread { pendant.connect() }

    @JavascriptInterface
    fun pendantDisconnect() = activity.runOnUiThread { pendant.disconnect() }

    @JavascriptInterface
    fun glyphReady(): Boolean = glyph.ready

    @JavascriptInterface
    fun glyphSize(): Int = glyph.size

    @JavascriptInterface
    fun glyphFrame(values: String) {
        val parts = values.split(',')
        glyph.show(IntArray(parts.size) { parts[it].trim().toIntOrNull() ?: 0 })
    }

    /** SAVE / STL: WebView can't download blob: URLs, so the page hands over the bytes. */
    @JavascriptInterface
    fun saveFile(name: String, mime: String, base64: String) {
        val bytes = Base64.decode(base64, Base64.DEFAULT)
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, name)
            put(MediaStore.Downloads.MIME_TYPE, mime)
        }
        val resolver = activity.contentResolver
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
        val ok = uri != null && runCatching {
            resolver.openOutputStream(uri)!!.use { it.write(bytes) }
        }.isSuccess
        activity.runOnUiThread {
            Toast.makeText(activity, if (ok) "Saved to Downloads: $name" else "Could not save $name", Toast.LENGTH_SHORT).show()
        }
    }
}
