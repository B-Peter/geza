import "./app.css";
import { registerSW } from "virtual:pwa-register";
import { mount } from "svelte";
import App from "./App.svelte";
import { app } from "./state.svelte.js";
import { requestPersistence } from "./store.js";

registerSW({ immediate: true });
void requestPersistence();
void app.init();

const target = document.getElementById("app");
if (target) mount(App, { target });
