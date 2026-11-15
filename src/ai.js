// Firebase AI Logic hybrid inference (Web).
// Docs: https://firebase.google.com/docs/ai-logic/hybrid/web/get-started
//       https://firebase.google.com/docs/ai-logic/hybrid/web/configuration-options
//       https://firebase.google.com/docs/ai-logic/hybrid/web/generate-structured-output
import { initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider, ReCaptchaV3Provider } from "firebase/app-check";
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode, InferenceSource, Schema } from "firebase/ai";
import { loadFirebaseConfig } from "./firebase-config.js";

export const CLOUD_MODEL = "gemini-3.5-flash-lite"; // SDK default fallback model; set explicitly for clarity.

let ai = null;
let configInfo = { configured: false, appCheck: "off", reason: "" };

export async function initFirebase() {
  const cfg = await loadFirebaseConfig();
  if (!cfg) {
    configInfo = { configured: false, appCheck: "off", reason: "No Firebase config found (public/firebase-config.json)." };
    return configInfo;
  }
  const { firebaseConfig, appCheck = {}, cloudModel } = cfg;
  const app = initializeApp(firebaseConfig);
  let appCheckMode = "off";
  try {
    const isLocal = ["localhost", "127.0.0.1"].includes(location.hostname);
    if (isLocal && new URLSearchParams(location.search).has("appcheckDebug")) {
      // Local development only. The debug token is printed in the console and must be
      // registered in the Firebase console. Never commit it.
      self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    }
    if (appCheck.recaptchaEnterpriseSiteKey) {
      initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(appCheck.recaptchaEnterpriseSiteKey), isTokenAutoRefreshEnabled: true });
      appCheckMode = "reCAPTCHA Enterprise";
    } else if (appCheck.recaptchaV3SiteKey) {
      initializeAppCheck(app, { provider: new ReCaptchaV3Provider(appCheck.recaptchaV3SiteKey), isTokenAutoRefreshEnabled: true });
      appCheckMode = "reCAPTCHA v3";
    } else if (self.FIREBASE_APPCHECK_DEBUG_TOKEN) {
      initializeAppCheck(app, { provider: new ReCaptchaV3Provider("debug-only"), isTokenAutoRefreshEnabled: true });
      appCheckMode = "debug";
    }
  } catch (e) {
    console.warn("App Check init failed", e);
  }
  // Gemini Developer API backend (free tier).
  ai = getAI(app, { backend: new GoogleAIBackend() });
  configInfo = { configured: true, appCheck: appCheckMode, cloudModel: cloudModel || CLOUD_MODEL };
  return configInfo;
}

export const MODE = {
  prefer_on_device: InferenceMode.PREFER_ON_DEVICE,
  only_on_device: InferenceMode.ONLY_ON_DEVICE,
  only_in_cloud: InferenceMode.ONLY_IN_CLOUD,
};

// ---- On-device availability (Chrome Prompt API) ----
export async function deviceAvailability() {
  if (!("LanguageModel" in self)) return "unsupported";
  try {
    return await self.LanguageModel.availability({
      expectedInputs: [{ type: "text", languages: ["en"] }],
      expectedOutputs: [{ type: "text", languages: ["en"] }],
    });
  } catch {
    return "unavailable";
  }
}

// ---- Structured bill schema (shared by on-device and cloud) ----
export const billSchema = Schema.object({
  properties: {
    merchant: Schema.string(),
    billType: Schema.enumString({ enum: ["utility", "telecom", "restaurant", "medical", "retail", "travel", "subscription", "other"] }),
    items: Schema.array({
      items: Schema.object({ properties: { description: Schema.string(), amount: Schema.number() } }),
    }),
    fees: Schema.array({
      items: Schema.object({
        properties: {
          name: Schema.string(),
          amount: Schema.number(),
          risk: Schema.enumString({ enum: ["low", "medium", "high"] }),
          why: Schema.string(),
        },
      }),
    }),
    total: Schema.number(),
    summary: Schema.string(),
  },
  optionalProperties: ["total"],
});

const SYSTEM = `You are HushLedger, a careful consumer-rights assistant.
You read bills and receipts and point out charges a reasonable customer could question.
Be factual. Never invent lines that are not on the bill. Amounts are numbers in the bill's currency.`;

const models = new Map();
function model(kind, modeKey) {
  const key = kind + ":" + modeKey;
  if (models.has(key)) return models.get(key);
  const json = kind === "bill";
  const m = getGenerativeModel(ai, {
    mode: MODE[modeKey],
    inCloudParams: {
      model: configInfo.cloudModel || CLOUD_MODEL,
      systemInstruction: SYSTEM,
      generationConfig: json
        ? { responseMimeType: "application/json", responseSchema: billSchema, temperature: 0.1 }
        : { temperature: 0.4, maxOutputTokens: 600 },
    },
    onDeviceParams: {
      createOptions: {
        expectedInputs: [{ type: "text", languages: ["en"] }],
        expectedOutputs: [{ type: "text", languages: ["en"] }],
        initialPrompts: [{ role: "system", content: [{ type: "text", value: SYSTEM }] }],
      },
      ...(json ? { promptOptions: { responseConstraint: billSchema } } : {}),
    },
  });
  models.set(key, m);
  return m;
}

export function isReady() { return !!ai; }

// Must be called from a user gesture (click). Starts the Gemini Nano download if needed.
export function warmDeviceModel(modeKey, onProgress) {
  if (!ai || modeKey === "only_in_cloud") return Promise.resolve();
  const p1 = model("bill", modeKey).initializeDeviceModel(onProgress);
  const p2 = model("note", modeKey).initializeDeviceModel();
  return Promise.allSettled([p1, p2]);
}

function where(response) {
  return response.inferenceSource === InferenceSource.ON_DEVICE ? "device" : "cloud";
}

export async function readBill(text, modeKey, hints = []) {
  const prompt = `Read this bill. List the regular line items in "items". Put every fee, surcharge, rental, automatic tip, duplicate line or vague charge in "fees" with a risk level and a one-sentence reason a customer could question it (low = normal, medium = worth asking, high = likely junk or error). Any line whose name contains "fee", "surcharge", "rental", "gratuity" or "recovery", and any vague line such as "misc" or "supplies", belongs in "fees", not "items". Taxes, payments and insurance credits stay in "items". If the same line appears twice, list the extra copy in "fees" as a possible double charge. "total" is the final amount due. "summary" is two short plain-English sentences for the customer.

BILL:
"""
${text}
"""${hints.length ? `

Notes from a local scan (check them, don't just copy them):
${hints.map((h) => "- " + h).join("\n")}` : ""}`;
  const t0 = performance.now();
  const result = await model("bill", modeKey).generateContent(prompt);
  const ms = Math.round(performance.now() - t0);
  const raw = result.response.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = JSON.parse(raw.replace(/^```(?:json)?|```$/g, "").trim()); }
  return { data, where: where(result.response), ms };
}

export async function draftNote({ merchant, fees, tone }, modeKey) {
  const list = fees.map((f) => `- ${f.name}: ${f.amount} (${f.why})`).join("\n");
  const toneText = { polite: "polite and warm", firm: "firm but respectful", brief: "very brief, 3–4 sentences" }[tone] || "polite";
  const prompt = `Write a ${toneText} message from a customer to ${merchant || "the company"} disputing these charges and asking for them to be removed or explained:
${list}

Rules: plain text, no subject line, under 170 words. Use the placeholders [Your name] and [Account number] instead of real details. Ask for a corrected bill and a reply in writing. Do not threaten legal action.`;
  const t0 = performance.now();
  const result = await model("note", modeKey).generateContent(prompt);
  return { text: result.response.text().trim(), where: where(result.response), ms: Math.round(performance.now() - t0), promptChars: prompt.length };
}
