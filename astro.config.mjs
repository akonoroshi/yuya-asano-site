// @ts-check
import { defineConfig } from "astro/config";

export default defineConfig({
  // Set the base URL for the site.
  site: "https://yuyaasano.dev",
  // Fully static output. No adapter needed until you add the /api/chat Worker.
  output: "static",
  // English at /, Japanese at /ja/. Pages for Japanese live in src/pages/ja/.
  i18n: {
    locales: ["en", "ja"],
    defaultLocale: "en",
    routing: { prefixDefaultLocale: false },
  },
});
