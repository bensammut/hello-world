/**
 * Bridge to the native Android shell (android/). Absent in a normal browser.
 * JS -> native: methods on `window.PixelMillNative` (addJavascriptInterface; strings/numbers only).
 * Native -> JS: the shell calls functions on `window.__pixelMill` via evaluateJavascript.
 */
export interface NativeApi {
  pendantConnect(): void;
  pendantDisconnect(): void;
  glyphReady(): boolean;
  glyphSize(): number;
  /** Comma-separated brightness values 0-255, row-major, glyphSize() x glyphSize(). */
  glyphFrame(values: string): void;
  saveFile(name: string, mime: string, base64: string): void;
}

export interface NativeEvents {
  onPendantState(state: string): void;
  onPendantPacket(bytes: number[]): void;
}

type NativeWindow = Window & { PixelMillNative?: NativeApi; __pixelMill?: Partial<NativeEvents> };

export function nativeApi(): NativeApi | null {
  return (window as NativeWindow).PixelMillNative ?? null;
}

export function onNative<K extends keyof NativeEvents>(name: K, fn: NativeEvents[K]) {
  const w = window as NativeWindow;
  w.__pixelMill ??= {};
  w.__pixelMill[name] = fn;
}

export function bytesToBase64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
