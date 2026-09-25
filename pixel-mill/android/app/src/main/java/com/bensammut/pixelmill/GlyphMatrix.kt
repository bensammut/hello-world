package com.bensammut.pixelmill

import android.content.ComponentName
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.nothing.ketchum.Common
import com.nothing.ketchum.Glyph
import com.nothing.ketchum.GlyphMatrixFrame
import com.nothing.ketchum.GlyphMatrixManager
import com.nothing.ketchum.GlyphMatrixObject

/**
 * App-controlled Glyph Matrix output. Frames are brightness grids from the web app; they go
 * through a Bitmap + GlyphMatrixObject so the SDK handles the device's own pixel format.
 */
class GlyphMatrix(context: Context) {
    private val ctx = context.applicationContext
    private var manager: GlyphMatrixManager? = null
    private val main = Handler(Looper.getMainLooper())
    private var recycledOnce = false

    @Volatile
    var ready = false
        private set

    /** Matrix edge length: 13 on Phone (4a) Pro, 25 on Phone (3). */
    val size: Int by lazy { runCatching { Common.getDeviceMatrixLength() }.getOrDefault(0) }

    private fun targetDevice(): String? = when {
        runCatching { Common.is25111p() }.getOrDefault(false) -> Glyph.DEVICE_25111p
        runCatching { Common.is23112() }.getOrDefault(false) -> Glyph.DEVICE_23112
        else -> null
    }

    fun start() {
        val device = targetDevice()
        if (device == null) {
            Log.i(TAG, "No Glyph Matrix on this device")
            return
        }
        if (manager != null) return
        val gm = GlyphMatrixManager.getInstance(ctx)
        manager = gm
        gm.init(object : GlyphMatrixManager.Callback {
            override fun onServiceConnected(name: ComponentName) {
                val ok = gm.register(device)
                if (!recycledOnce) {
                    // A process killed without releasing the matrix (reinstall, OS kill) leaves a stale
                    // session that outranks ours and freezes the LEDs. Only a full release + reconnect
                    // clears it, so do that once per process before streaming.
                    recycledOnce = true
                    runCatching { gm.closeAppMatrix() }
                    runCatching { gm.unInit() }
                    manager = null
                    main.postDelayed({ start() }, 300)
                    return
                }
                // Without this the system reclaims the matrix a few seconds into streaming.
                runCatching { gm.setGlyphMatrixTimeout(false) }.onFailure { Log.w(TAG, "setGlyphMatrixTimeout", it) }
                ready = ok
                Log.i(TAG, "Glyph service connected, register($device) = $ok, size = $size")
            }

            override fun onServiceDisconnected(name: ComponentName) {
                ready = false
            }
        })
    }

    fun stop() {
        main.removeCallbacksAndMessages(null)
        val gm = manager ?: return
        if (ready) runCatching { gm.closeAppMatrix() }.onFailure { Log.w(TAG, "closeAppMatrix", it) }
        ready = false
        runCatching { gm.unInit() }
        manager = null
    }

    fun show(values: IntArray) {
        val gm = manager ?: return
        val n = size
        if (!ready || n <= 0 || values.size != n * n) return
        val bitmap = Bitmap.createBitmap(n, n, Bitmap.Config.ARGB_8888)
        val pixels = IntArray(n * n) { i ->
            val v = values[i].coerceIn(0, 255)
            Color.argb(255, v, v, v)
        }
        bitmap.setPixels(pixels, 0, n, 0, 0, n, n)
        val image = GlyphMatrixObject.Builder().setImageSource(bitmap).setPosition(0, 0).setScale(100).build()
        val frame = GlyphMatrixFrame.Builder().addTop(image).build(ctx)
        runCatching { gm.setAppMatrixFrame(frame) }.onFailure { Log.w(TAG, "setAppMatrixFrame", it) }
    }

    private companion object {
        const val TAG = "PixelMillGlyph"
    }
}
