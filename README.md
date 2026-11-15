# HushLedger — check a bill without handing it over

HushLedger is a private bill and receipt checker for the web. Paste the text of a phone, internet, restaurant or clinic bill. HushLedger finds the line items, flags junk or disputable fees, checks the math, and drafts a polite dispute note.

It is built on **Firebase AI Logic hybrid inference**. The AI runs **on-device with Gemini Nano in Chrome** when the model is there, and falls back automatically to **Gemini in the cloud through the Gemini Developer API** when it isn't. Every AI answer in the UI is labelled with where it actually ran.

Built for #BuildHybridAI 2026 (Web / Chrome).

> Built by Luis Alfredo Salazar Courtois with AI coding assistance (Grok Bot).

## Links

- [Live demo](https://hushledger.vercel.app)
- [Demo video](https://youtu.be/qkkIatoE9OA)

## Why hybrid fits this problem

Bills are some of the most private text people have: account numbers, addresses, what they ate, what their doctor billed. Yet "junk fees" cost households real money, and most people never question them.

- **On-device first.** With Gemini Nano in Chrome, the bill never leaves the laptop. It's free to run and works offline.
- **Cloud when needed.** On phones, older laptops or browsers without the on-device model, the same request falls back to Gemini in the cloud, so everyone gets an answer.
- **Shield before the cloud.** Before any prompt is built, a local privacy shield masks card numbers, account numbers, phone numbers and emails, so even the cloud path sees less.
- **Show, don't hide.** Each answer carries an *On this device* or *Cloud fallback* badge read from the SDK's `inferenceSource`, and a **Privacy trail** lists every request, where it ran and how many characters left the page.

## What it does

1. **Instant scan (no AI, plain JavaScript).** Totals every line, compares the sum to the bill's stated total, finds duplicate lines and known junk-fee patterns (TV surcharges on internet plans, "regulatory recovery" fees, paper-statement fees, kitchen-appreciation fees, auto-gratuity, facility fees and more). It works offline in milliseconds.
2. **AI read of the bill.** Firebase AI Logic with `InferenceMode.PREFER_ON_DEVICE` returns **structured JSON** (merchant, bill type, items, fees with a low/medium/high risk and a reason, total and a two-sentence summary). Duplicate lines found by the instant scan are passed along as hints for the model to check. The schema is enforced on both paths: `responseConstraint` on-device and `responseMimeType` + `responseSchema` in the cloud.
3. **Math check.** The AI's total is compared with the bill's own total, so a wrong AI reading is called out instead of trusted.
4. **Dispute note.** A second hybrid request drafts a short note (polite, firm or very brief) that uses `[Your name]` and `[Account number]` placeholders, so no personal details are needed. If no AI is available, a plain template is filled from the instant scan and labelled *Template · no AI*.
5. **Three modes.** *Hybrid* (`PREFER_ON_DEVICE`), *Private only* (`ONLY_ON_DEVICE`, which never touches the network) and *Cloud* (`ONLY_IN_CLOUD`).
6. **Model download.** If Chrome reports the model as downloadable, a *Get on-device model* button calls `initializeDeviceModel()` from a click and shows download progress.

## How Firebase AI Logic is used (code map)

| File | What it does |
| --- | --- |
| `src/ai.js` | `initializeApp`, optional App Check, `getAI(app, { backend: new GoogleAIBackend() })`, `getGenerativeModel(ai, { mode: InferenceMode.PREFER_ON_DEVICE, inCloudParams, onDeviceParams })`, `initializeDeviceModel()`, `generateContent()`, and `response.inferenceSource` (`ON_DEVICE` / `IN_CLOUD`). |
| `src/main.js` | UI, the source badges, the privacy trail and the mode switch. |
| `src/rules.js` | The no-AI instant scan, the math check and the privacy shield (redaction). |
| `src/firebase-config.js` | Loads the public Firebase web config at runtime. |

Key snippet (`src/ai.js`):

```js
const model = getGenerativeModel(ai, {
  mode: InferenceMode.PREFER_ON_DEVICE,
  inCloudParams: {
    model: "gemini-3.5-flash-lite",
    systemInstruction: SYSTEM,
    generationConfig: { responseMimeType: "application/json", responseSchema: billSchema },
  },
  onDeviceParams: {
    createOptions: { expectedInputs: [{ type: "text", languages: ["en"] }], expectedOutputs: [{ type: "text", languages: ["en"] }] },
    promptOptions: { responseConstraint: billSchema },
  },
});
model.initializeDeviceModel(onProgress);            // on the user's click
const result = await model.generateContent(prompt);
result.response.inferenceSource;                    // "on_device" or "in_cloud"
```

## Run it locally

Requirements: Node 20+ and a Firebase project with **Firebase AI Logic** enabled and the **Gemini Developer API** provider (free Spark plan is enough).

```bash
npm install
cp firebase-config.example.json ../firebase-config.json   # or set FIREBASE_CONFIG_PATH
# edit it with your Firebase web app config
npm run dev        # http://localhost:5173
npm test           # checks for the no-AI scanner and the privacy shield
npm run build && npm run preview
```

`npm run dev` and `npm run build` copy the config into `public/firebase-config.json`, which is git-ignored. Without a config the app still runs the instant scan and template note, and clearly says the AI is off. To hard-code the config instead, change the single `INLINE_CONFIG` line in `src/firebase-config.js`.

The Firebase web config is not a secret, but keep it out of git anyway and protect the API with App Check.

### App Check

Firebase AI Logic is meant to be protected by App Check. HushLedger supports:

- **reCAPTCHA Enterprise** or **reCAPTCHA v3** for the hosted site: add `"appCheck": { "recaptchaEnterpriseSiteKey": "..." }` (or `recaptchaV3SiteKey`) to the config file.
- **Debug provider** for local development: open `http://localhost:5173/?appcheckDebug=1`, copy the debug token from the console, and register it in the Firebase console (*App Check → Apps → Manage debug tokens*). Never commit the token.

### Turn on Gemini Nano in Chrome (for the on-device path)

1. Use Chrome on desktop, version 139 or newer.
2. Enable `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` and restart Chrome.
3. Open HushLedger and press **Get on-device model** (or just press **Check this bill**; the download starts in the background, and the request falls back to the cloud until the model is ready).
4. When the chip says *On-device AI: Gemini Nano ready*, answers will carry the green **On this device** badge, and the Privacy trail will show *nothing (stayed in Chrome)*.

## What was built during the submission period

Everything in this repository was written for #BuildHybridAI 2026, starting 15 November 2026. No pre-existing project code is included. Third-party code is limited to the open-source Firebase JS SDK and Vite, used under their licenses. The sample bills are fictional.

## Disclosure

Built by Luis Alfredo Salazar Courtois with AI coding assistance (Grok Bot), as the contest rules allow.

HushLedger is not legal or financial advice. Always check the AI's reading against your actual bill.

## License

Apache License 2.0. See [LICENSE](LICENSE).
