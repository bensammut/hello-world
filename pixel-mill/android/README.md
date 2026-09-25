# PIXEL MILL for Android

A native Android app (Kotlin) that runs PIXEL MILL full-screen and adds features the browser
can't provide:

- **Glyph Matrix livestream** (Nothing Phone (4a) Pro, 13×13; also works on Phone (3), 25×25).
  The rear matrix shows a live isometric view of the part at 15 fps, with the tool blinking.
  Glyph Toys (for example the always-on battery toy) outrank apps and can briefly take over.
- **K.O.-style control surface** (`android.html`, `src/ui/android/`): chassis rails, dark keys, a
  segment display and a MORE sheet, with the 3D scene retuned to match (`src/theme/androidTheme.ts`).
  Landscape first, portrait supported; the app follows the phone's rotation sensor.
- **Native Bluetooth** for the XIAO pendant, because Android WebView has no Web Bluetooth.
- **Touch camera:** one finger cuts, two fingers drag to orbit, pinch to zoom.
- **SAVE / STL** write to Downloads, and **OPEN** uses the system file picker.

The game itself is the same code as the website, built from its own entry (`android.html` +
`src/main.android.ts`, `vite --mode android`), so the website's look and input stay unchanged.
Every Android build runs `npm run build:android` first and bundles the output into
`app/src/main/assets/www`, where it's served offline from `https://appassets.androidplatform.net`.
Preview it on the desktop with `npm run dev:android` and open `/android.html`.

## Setup

1. **Glyph Matrix SDK.** Nothing's licence doesn't allow redistributing it, so it isn't in
   git. Download `glyph-matrix-sdk-2.0.aar` from
   <https://github.com/Nothing-Developer-Programme/GlyphMatrix-Developer-Kit> and put it in
   `app/libs/`.
2. Run `npm install` once in `pixel-mill/`.
3. Open this `android/` folder in Android Studio and press **Run**. Or, from the command line:

   ```bash
   ./gradlew installDebug
   ```

   Command-line builds need a JDK 17 or newer. Android Studio's bundled one works:
   `export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"`.

## Using it

- The Glyph Matrix feed starts when the app opens and hands the matrix back to the system when
  you leave. Pressing the Glyph Button opens the Glyph Toy carousel, which temporarily takes
  over the matrix (a system rule).
- **CONNECT PENDANT** scans for the pendant and connects directly, with no picker. Allow
  **Nearby devices** the first time. The pendant accepts one connection at a time, so
  disconnect it in any desktop browser first.

## Layout

| File | Purpose |
| --- | --- |
| `MainActivity.kt` | Full-screen WebView, asset loader, file picker, lifecycle |
| `NativeBridge.kt` | `window.PixelMillNative` methods called from the web app |
| `PendantBle.kt` | Scans, connects and subscribes to the pendant's state characteristic |
| `GlyphMatrix.kt` | Registers with the Glyph service and shows frames with `setAppMatrixFrame` |

The web side of the bridge is `src/native/bridge.ts`, and the depth-map renderer is
`src/native/GlyphFeed.ts`.
