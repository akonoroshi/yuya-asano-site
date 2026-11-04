// @ts-check
import { defineConfig } from "astro/config";

export default defineConfig({
  // TODO: set to your custom domain once you buy it (used for canonical URLs and hreflang tags)
  site: "https://example.com",
  // Fully static output. No adapter needed until you add the /api/chat Worker.
  output: "static",
  // English at /, Japanese at /ja/. Pages for Japanese live in src/pages/ja/.
  i18n: {
    locales: ["en", "ja"],
    defaultLocale: "en",
    routing: { prefixDefaultLocale: false },
  },
});
