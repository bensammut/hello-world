import { defineConfig } from "vite";

// Relative base so the build works from any sub-path (GitHub Pages serves it at /hello-world/pixel-mill/play/).
export default defineConfig({
  base: "./",
});
