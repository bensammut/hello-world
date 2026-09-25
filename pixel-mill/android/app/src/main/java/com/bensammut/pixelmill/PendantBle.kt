package com.bensammut.pixelmill

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.pm.PackageManager
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import java.util.UUID

/**
 * BLE client for the XIAO pendant: scans for its service, subscribes to the state
 * characteristic and forwards each 8-byte packet. Replaces Web Bluetooth, which Android
 * WebView doesn't provide.
 */
@SuppressLint("MissingPermission") // every entry point checks hasPermissions() first
class PendantBle(private val activity: Activity, private val listener: Listener) {

    interface Listener {
        /** scanning, connecting, connected, disconnected, timeout, denied, bluetooth-off, unavailable */
        fun onPendantState(state: String)
        fun onPendantPacket(bytes: ByteArray)
    }

    companion object {
        val SERVICE: UUID = UUID.fromString("7e5a0001-6c1d-4b5e-9a3b-2f1c0d9e8a70")
        val STATE: UUID = UUID.fromString("7e5a0002-6c1d-4b5e-9a3b-2f1c0d9e8a70")
        val CCCD: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
        const val PERMISSION_REQUEST = 42
        private const val SCAN_TIMEOUT_MS = 10_000L
        private val PERMISSIONS = arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
    }

    private val adapter = activity.getSystemService(BluetoothManager::class.java)?.adapter
    private val main = Handler(Looper.getMainLooper())
    private var gatt: BluetoothGatt? = null
    private var scanning = false
    private var connectAfterPermission = false

    private fun hasPermissions() = PERMISSIONS.all {
        activity.checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED
    }

    fun connect() {
        val bt = adapter ?: return listener.onPendantState("unavailable")
        if (!hasPermissions()) {
            connectAfterPermission = true
            activity.requestPermissions(PERMISSIONS, PERMISSION_REQUEST)
            return
        }
        if (!bt.isEnabled) return listener.onPendantState("bluetooth-off")
        if (scanning || gatt != null) return
        val scanner = bt.bluetoothLeScanner ?: return listener.onPendantState("bluetooth-off")
        scanning = true
        listener.onPendantState("scanning")
        val filter = ScanFilter.Builder().setServiceUuid(ParcelUuid(SERVICE)).build()
        val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build()
        scanner.startScan(listOf(filter), settings, scanCallback)
        main.postDelayed(scanTimeout, SCAN_TIMEOUT_MS)
    }

    fun onPermissionResult(granted: Boolean) {
        if (!connectAfterPermission) return
        connectAfterPermission = false
        if (granted) connect() else listener.onPendantState("denied")
    }

    fun disconnect() {
        stopScan()
        gatt?.disconnect()
        gatt?.close()
        gatt = null
        listener.onPendantState("disconnected")
    }

    private val scanTimeout = Runnable {
        if (scanning) {
            stopScan()
            listener.onPendantState("timeout")
        }
    }

    private fun stopScan() {
        if (!scanning) return
        scanning = false
        main.removeCallbacks(scanTimeout)
        if (hasPermissions()) adapter?.bluetoothLeScanner?.stopScan(scanCallback)
    }

    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) {
            if (!scanning) return
            stopScan()
            listener.onPendantState("connecting")
            gatt = result.device.connectGatt(activity, false, gattCallback, BluetoothDevice.TRANSPORT_LE)
        }

        override fun onScanFailed(errorCode: Int) {
            scanning = false
            main.removeCallbacks(scanTimeout)
            listener.onPendantState("disconnected")
        }
    }

    private val gattCallback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                // Short connection interval: the pendant streams at up to 50 Hz.
                g.requestConnectionPriority(BluetoothGatt.CONNECTION_PRIORITY_HIGH)
                g.discoverServices()
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                g.close()
                if (gatt == g) gatt = null
                listener.onPendantState("disconnected")
            }
        }

        override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
            val ch = g.getService(SERVICE)?.getCharacteristic(STATE)
            val cccd = ch?.getDescriptor(CCCD)
            if (ch == null || cccd == null) {
                g.disconnect()
                return
            }
            g.setCharacteristicNotification(ch, true)
            g.writeDescriptor(cccd, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
        }

        override fun onDescriptorWrite(g: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
            if (descriptor.uuid == CCCD && status == BluetoothGatt.GATT_SUCCESS) listener.onPendantState("connected")
        }

        override fun onCharacteristicChanged(g: BluetoothGatt, ch: BluetoothGattCharacteristic, value: ByteArray) {
            if (ch.uuid == STATE) listener.onPendantPacket(value)
        }
    }
}
