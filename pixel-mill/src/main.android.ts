// Android app entry (android.html, built with --mode android). The website uses main.ts.
// The theme import must stay first: it retunes shared colour tables before scene modules read them.
import "./theme/androidTheme";
import "@fontsource/space-grotesk/300.css";
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/700.css";
import "./ui/style.css";
import "./ui/android/android.css";
import { App } from "./App";
import { mountAndroidLayer } from "./ui/android/AndroidLayer";

const app = new App(document.getElementById("app")!);
mountAndroidLayer(app.store);
if (import.meta.env.DEV) (window as unknown as { app: App }).app = app;
