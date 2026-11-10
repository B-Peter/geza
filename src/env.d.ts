/// <reference types="svelte" />
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SPOTIFY_CLIENT_ID?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Short commit and build time, injected by vite.config.ts. */
declare const __APP_VERSION__: string;
