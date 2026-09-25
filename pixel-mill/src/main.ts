import "@fontsource/press-start-2p/400.css";
import "@fontsource/vt323/400.css";
import "./ui/style.css";
import { App } from "./App";

const app = new App(document.getElementById("app")!);
if (import.meta.env.DEV) (window as unknown as { app: App }).app = app;
