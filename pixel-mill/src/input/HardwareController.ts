import { nativeApi, onNative } from "../native/bridge";

export const PENDANT_SERVICE = "7e5a0001-6c1d-4b5e-9a3b-2f1c0d9e8a70";
export const PENDANT_STATE = "7e5a0002-6c1d-4b5e-9a3b-2f1c0d9e8a70";

export interface PendantState { x: number; y: number; z: number; buttons: number; }

const ADC_MIN = 40;
const ADC_MAX = 4050;
const norm = (v: number) => Math.min(1, Math.max(0, (v - ADC_MIN) / (ADC_MAX - ADC_MIN)));

export class HardwareController {
  connected = false;
  state: PendantState = { x: 0.5, y: 0.5, z: 0, buttons: 0 };
  onButton: (bit: number) => void = () => {};
  private device: any = null;
  private button: HTMLButtonElement;
  private lastButtons = 0;
  private native = nativeApi();

  constructor(uiRoot: HTMLElement) {
    this.button = document.createElement("button");
    this.button.id = "pendant-btn";
    this.button.textContent = "CONNECT PENDANT";
    // Sits just above the camera preset panel, which occupies the bottom-right corner.
    Object.assign(this.button.style, {
      position: "absolute", right: "8px",
      bottom: "calc(56px + env(safe-area-inset-bottom, 0px))",
      zIndex: "20", pointerEvents: "auto", fontSize: "10px", padding: "8px 10px",
    });
    if (this.native) {
      // Android app: Bluetooth runs natively (WebView has no Web Bluetooth) and pushes packets here.
      onNative("onPendantState", (s) => this.onNativeState(s));
      onNative("onPendantPacket", (bytes) => this.parse(new DataView(Uint8Array.from(bytes).buffer)));
    } else if (!(navigator as any).bluetooth) {
      this.button.textContent = "NO BLUETOOTH";
      this.button.disabled = true;
    }
    this.button.addEventListener("click", () => (this.connected ? this.disconnect() : void this.connect()));
    uiRoot.appendChild(this.button);
  }

  async connect() {
    if (this.native) {
      this.button.textContent = "SCANNING...";
      this.native.pendantConnect();
      return;
    }
    const bt = (navigator as any).bluetooth;
    if (!bt) return;
    try {
      this.button.textContent = "PAIRING...";
      this.device = await bt.requestDevice({ filters: [{ services: [PENDANT_SERVICE] }] });
      this.device.addEventListener("gattserverdisconnected", () => this.handleDisconnect());
      const server = await this.device.gatt.connect();
      const service = await server.getPrimaryService(PENDANT_SERVICE);
      const ch = await service.getCharacteristic(PENDANT_STATE);
      ch.addEventListener("characteristicvaluechanged", (e: Event) => this.parse((e.target as any).value as DataView));
      await ch.startNotifications();
      this.connected = true;
      this.button.textContent = "PENDANT ON";
      this.button.style.color = "var(--green)";
    } catch (err) {
      console.warn("Pendant connect failed:", err);
      this.handleDisconnect();
    }
  }

  disconnect() {
    if (this.native) this.native.pendantDisconnect();
    if (this.device?.gatt?.connected) this.device.gatt.disconnect();
    this.handleDisconnect();
  }

  private onNativeState(state: string) {
    if (state === "scanning") this.button.textContent = "SCANNING...";
    else if (state === "connecting") this.button.textContent = "PAIRING...";
    else if (state === "connected") {
      this.connected = true;
      this.button.textContent = "PENDANT ON";
      this.button.style.color = "var(--green)";
    } else {
      this.handleDisconnect();
      const why: Record<string, string> = { timeout: "NOT FOUND", denied: "NO PERMISSION", "bluetooth-off": "BLUETOOTH OFF" };
      if (why[state]) {
        this.button.textContent = why[state];
        setTimeout(() => !this.connected && (this.button.textContent = "CONNECT PENDANT"), 2500);
      }
    }
  }

  private handleDisconnect() {
    this.connected = false;
    this.lastButtons = 0;
    this.button.textContent = "CONNECT PENDANT";
    this.button.style.color = "";
  }

  private parse(v: DataView) {
    if (v.byteLength < 7) return;
    const buttons = v.getUint8(6);
    this.state = { x: norm(v.getUint16(0, true)), y: norm(v.getUint16(2, true)), z: norm(v.getUint16(4, true)), buttons };
    const rising = buttons & ~this.lastButtons;
    this.lastButtons = buttons;
    for (let bit = 0; bit < 8; bit++) if (rising & (1 << bit)) this.onButton(bit);
  }
}
