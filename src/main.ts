import "./app.css";
import { registerSW } from "virtual:pwa-register";
import { mount } from "svelte";
import App from "./App.svelte";
import { framed } from "./frame-guard.js";
import { app } from "./state.svelte.js";
import { requestPersistence } from "./store.js";

// GitHub Pages can't send X-Frame-Options or frame-ancestors, so refuse to
// run inside another site's frame (clickjacking on Apply / Remove key).
if (!framed()) {
  registerSW({ immediate: true });
  void requestPersistence();
  void app.init();
  const target = document.getElementById("app");
  if (target) mount(App, { target });
}
