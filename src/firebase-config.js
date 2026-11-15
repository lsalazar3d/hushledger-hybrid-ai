// Firebase web config is loaded at runtime from /firebase-config.json (public/, git-ignored).
// `npm run build` / `npm run dev` copy it there from ../firebase-config.json or $FIREBASE_CONFIG_PATH.
//
// One-line swap if you prefer to hard-code it: replace INLINE_CONFIG = null with your config object.
// Firebase web config is public by design (it is not a secret); protect the API with App Check.
const INLINE_CONFIG = null; // e.g. { apiKey: "...", authDomain: "...", projectId: "...", appId: "..." }

export async function loadFirebaseConfig() {
  let raw = INLINE_CONFIG;
  if (!raw) {
    try {
      const res = await fetch("/firebase-config.json", { cache: "no-store" });
      if (res.ok) raw = await res.json();
    } catch { /* offline or missing */ }
  }
  if (!raw) return null;
  // Accept either a bare Firebase config or { firebaseConfig, appCheck, cloudModel }.
  const firebaseConfig = raw.firebaseConfig || raw;
  if (!firebaseConfig.apiKey || !firebaseConfig.projectId || String(firebaseConfig.apiKey).startsWith("YOUR_")) return null;
  const appCheck = raw.appCheck || {
    recaptchaEnterpriseSiteKey: raw.recaptchaEnterpriseSiteKey,
    recaptchaV3SiteKey: raw.recaptchaV3SiteKey,
  };
  const clean = { ...firebaseConfig };
  for (const k of ["appCheck", "recaptchaEnterpriseSiteKey", "recaptchaV3SiteKey", "cloudModel", "firebaseConfig"]) delete clean[k];
  return { firebaseConfig: clean, appCheck, cloudModel: raw.cloudModel };
}
