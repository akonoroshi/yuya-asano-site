import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { characterCheckout } from "./character-checkout.mjs";

const require = createRequire(import.meta.url);
const source = join(characterCheckout ?? dirname(require.resolve("@tonari/characters/package.json")), "assets");
const destination = fileURLToPath(new URL("../public/characters/", import.meta.url));

const files = [
  "avatars/shino.vrm",
  "avatars/shino.gestures.json",
  "avatars/shino.png",
  "avatars/shino-iris.png",
  "avatars/shino-uniform.png",
  "avatars/shino-ribbon.png",
  "avatars/hair-sheen.png",
  "avatars/LICENSES.md",
  "animations/study-seated.vrma",
  "animations/100style-NOTICE.txt",
  "animations/Quaternius-LICENSE.txt",
  "animations/THIRD_PARTY_NOTICES.md",
  "motion-references/NOTICE.md",
];

await Promise.all(files.map(async (file) => {
  const target = join(destination, file);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(join(source, file), target);
}));
