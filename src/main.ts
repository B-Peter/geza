import "./app.css";
import { registerSW } from "virtual:pwa-register";
import { mount } from "svelte";
import App from "./App.svelte";
import { framed } from "./frame-guard.js";
import { app } from "./state.svelte.js";
import { requestPersistence } from "./store.js";
import { updateMessage } from "./whatsNew.js";

// GitHub Pages can't send X-Frame-Options or frame-ancestors, so refuse to
// run inside another site's frame (clickjacking on Apply / Remove key).
if (!framed()) {
  registerSW({
    immediate: true,
    // iOS keeps home-screen apps suspended rather than closed, so the browser's
    // own update check can lag for a long time. Check on launch and whenever
    // the app comes back to the foreground; autoUpdate then reloads into it.
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      const check = () => {
        if (navigator.onLine) void registration.update().catch(() => {});
      };
      check();
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") check();
      });
    },
  });
  void requestPersistence();
  void app.init().then(() => {
    const news = updateMessage(__APP_VERSION__);
    if (news) app.notify(news, "ok", 3000);
  });
  const target = document.getElementById("app");
  if (target) mount(App, { target });
}
