// @ts-check
import { defineConfig } from "astro/config";

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
});
