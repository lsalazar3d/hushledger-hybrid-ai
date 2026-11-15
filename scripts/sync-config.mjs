// Copies the Firebase web config into public/firebase-config.json (git-ignored) if one exists.
import fs from "node:fs";
import path from "node:path";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const candidates = [process.env.FIREBASE_CONFIG_PATH, path.join(root, "firebase-config.json"), path.join(root, "..", "firebase-config.json")].filter(Boolean);
const src = candidates.find((p) => fs.existsSync(p));
const dest = path.join(root, "public", "firebase-config.json");
if (src) {
  fs.copyFileSync(src, dest);
  console.log(`[sync-config] using ${path.relative(root, src) || src}`);
} else if (!fs.existsSync(dest)) {
  console.log("[sync-config] no firebase-config.json found; app will run the local scan only. See firebase-config.example.json.");
}
