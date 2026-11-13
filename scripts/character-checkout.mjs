import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const checkout = new URL("../../vrm-characters/", import.meta.url);

export const characterCheckout = existsSync(new URL("package.json", checkout))
  ? fileURLToPath(checkout)
  : undefined;
