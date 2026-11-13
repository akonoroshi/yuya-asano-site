// @ts-check
import { defineConfig } from "astro/config";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { characterCheckout } from "./scripts/character-checkout.mjs";

export default defineConfig({
  // Set the base URL for the site.
  site: "https://yuyaasano.dev",
  // Fully static output. The chat API is a separate Worker (worker/index.ts, see wrangler.jsonc),
  // so no Astro adapter is needed.
  output: "static",
  // English at /, Japanese at /ja/. Pages for Japanese live in src/pages/ja/.
  i18n: {
    locales: ["en", "ja"],
    defaultLocale: "en",
    routing: { prefixDefaultLocale: false },
  },
  vite: characterCheckout ? {
    resolve: {
      alias: {
        "@tonari/characters/react": join(characterCheckout, "src/react.ts"),
        "@tonari/characters/gestures": join(characterCheckout, "src/gestures.ts"),
        "@tonari/characters/models": join(characterCheckout, "src/models/bundled.ts"),
      },
      dedupe: ["react", "react-dom", "three"],
    },
    server: { fs: { allow: [fileURLToPath(new URL(".", import.meta.url)), characterCheckout] } },
  } : undefined,
});
