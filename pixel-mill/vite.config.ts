import { defineConfig } from "vite";

// Relative base so the build works from any sub-path (GitHub Pages serves it at /hello-world/pixel-mill/play/).
// --mode android builds the phone app's entry (android.html) instead of the website's index.html.
export default defineConfig(({ mode }) => ({
  base: "./",
  build: mode === "android" ? { rollupOptions: { input: "android.html" } } : {},
}));
