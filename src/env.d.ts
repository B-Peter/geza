/// <reference types="svelte" />
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SPOTIFY_CLIENT_ID?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** The version number (e.g. "0.1.37"), injected by vite.config.ts. */
declare const __APP_VERSION__: string;
/** Short commit and build time, injected by vite.config.ts. */
declare const __APP_BUILD__: string;
