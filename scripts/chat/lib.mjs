// Shared by the chat build scripts. Node runs the TypeScript in src/lib/chat directly
// (type stripping), so these scripts use exactly the same matching code as the browser.
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
export const root = path.resolve(import.meta.dirname, "../..");
export const outDir = path.join(root, "public/chat");

export function kuromojiDir() {
  return path.dirname(require.resolve("kuromoji/package.json"));
}

/** kuromoji's Node build, with the dictionary from node_modules. */
export function loadTokenizer() {
  const kuromoji = require("kuromoji");
  return new Promise((resolve, reject) =>
    kuromoji.builder({ dicPath: path.join(kuromojiDir(), "dict") }).build((err, t) => (err ? reject(err) : resolve(t))),
  );
}

export function fail(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}
