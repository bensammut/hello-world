package com.bensammut.pixelmill

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import org.json.JSONArray
import org.json.JSONObject

/**
 * Full-screen shell around the bundled PIXEL MILL web build (assets/www), served from a
 * virtual https origin so ES modules load. Adds native BLE for the pendant, the Glyph Matrix
 * feed, file open and save-to-Downloads.
 */
class MainActivity : Activity(), PendantBle.Listener {

    private lateinit var web: WebView
    private lateinit var pendant: PendantBle
    private lateinit var glyph: GlyphMatrix
    private var fileChooser: ValueCallback<Array<Uri>>? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        pendant = PendantBle(this, this)
        glyph = GlyphMatrix(this)

        val assets = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        web = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            webViewClient = object : WebViewClientCompat() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                    assets.shouldInterceptRequest(request.url)
            }
            webChromeClient = object : WebChromeClient() {
                override fun onShowFileChooser(
                    view: WebView,
                    callback: ValueCallback<Array<Uri>>,
                    params: FileChooserParams,
                ): Boolean {
                    fileChooser?.onReceiveValue(null)
                    fileChooser = callback
                    val pick = Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*")
                    startActivityForResult(pick, REQUEST_OPEN)
                    return true
                }
            }
            addJavascriptInterface(NativeBridge(this@MainActivity, pendant, glyph), "PixelMillNative")
        }

        // Keep the UI clear of the camera cutout; the page itself fills the rest edge to edge.
        val root = FrameLayout(this).apply {
            setBackgroundColor(getColor(R.color.ground))
            addView(web)
            setOnApplyWindowInsetsListener { v, insets ->
                val cut = insets.getInsets(WindowInsets.Type.displayCutout())
                v.setPadding(cut.left, cut.top, cut.right, cut.bottom)
                insets
            }
        }
        setContentView(root)
        // Only valid once the decor view exists.
        window.insetsController?.apply {
            hide(WindowInsets.Type.systemBars())
            systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
        web.loadUrl("https://appassets.androidplatform.net/assets/www/android.html")
    }

    override fun onResume() {
        super.onResume()
        web.onResume()
        glyph.start()
    }

    override fun onPause() {
        glyph.stop()
        web.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        pendant.disconnect()
        web.destroy()
        super.onDestroy()
    }

    @Deprecated("Activity result API is fine for a single file picker")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == REQUEST_OPEN) {
            val uri = data?.data
            fileChooser?.onReceiveValue(if (resultCode == RESULT_OK && uri != null) arrayOf(uri) else null)
            fileChooser = null
            return
        }
        super.onActivityResult(requestCode, resultCode, data)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<String>, grantResults: IntArray) {
        if (requestCode == PendantBle.PERMISSION_REQUEST) {
            pendant.onPermissionResult(grantResults.isNotEmpty() && grantResults.all { it == android.content.pm.PackageManager.PERMISSION_GRANTED })
        }
    }

    // PendantBle.Listener: may be called on Bluetooth binder threads.
    override fun onPendantState(state: String) = sendToWeb("onPendantState", JSONObject.quote(state))

    override fun onPendantPacket(bytes: ByteArray) {
        val arr = JSONArray()
        for (b in bytes) arr.put(b.toInt() and 0xFF)
        sendToWeb("onPendantPacket", arr.toString())
    }

    private fun sendToWeb(fn: String, arg: String) {
        web.post { web.evaluateJavascript("window.__pixelMill && window.__pixelMill.$fn && window.__pixelMill.$fn($arg)", null) }
    }

    private companion object {
        const val REQUEST_OPEN = 7
    }
}
