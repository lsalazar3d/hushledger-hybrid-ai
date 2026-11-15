// Instant, deterministic scan. Plain JavaScript, no AI, no network.
// It gives the user something useful in milliseconds, works offline,
// and is used to sanity-check the AI's numbers afterwards.

const MONEY = /(-?)\$?\s?(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})\s*$/;

const KINDS = [
  ["total", /\b(total|amount (you )?owe|balance due|amount due|total due)\b/i],
  ["subtotal", /\bsub-?total\b/i],
  ["tax", /\b(tax|vat|gst)\b/i],
  ["credit", /\b(adjust|paid|payment|credit|discount|refund|promo credit)\b/i],
  ["tip", /\b(gratuity|tip|service charge)\b/i],
  ["fee", /\b(fee|surcharge|recovery|rental|charge)\b/i],
];

// Words that often mark junk, hidden or disputable fees.
export const SUSPICIOUS = [
  [/broadcast tv|sports surcharge/i, "TV surcharges are often added to internet-only plans."],
  [/regulatory recovery|network enhancement|administrative|admin fee/i, "A company fee named to look like a government charge."],
  [/paper statement|paper bill/i, "Usually waived if you switch to e-bills."],
  [/late fee/i, "Check the payment date: was it really late?"],
  [/convenience|processing|service fee/i, "A fee just for paying or booking; often negotiable."],
  [/kitchen appreciation|wellness fee|living wage fee|staff fee/i, "Restaurant add-on fee; ask for it to be removed if it wasn't disclosed."],
  [/auto(matic)? gratuity/i, "Automatic tip: make sure you don't tip twice."],
  [/facility fee/i, "Hospital-style fee; ask for an itemized reason and whether insurance should cover it."],
  [/rental/i, "Equipment rental: you may own your own device or be able to return it."],
  [/resort fee|destination fee|amenity fee/i, "Mandatory add-on fee; often disputable if not shown up front."],
  [/misc|supplies/i, "Vague line item; ask for an itemized breakdown."],
  [/promo ended|promo expired|promotion ended/i, "A promo just ended; ask for a retention rate.", "rate"],
];

function toNumber(sign, whole, cents) {
  const n = Number(whole.replace(/,/g, "")) + Number(cents) / 100;
  return sign === "-" ? -n : n;
}

export function parseLines(text) {
  const rows = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(MONEY);
    if (!m) continue;
    const amount = toNumber(m[1], m[2], m[3]);
    const label = line.slice(0, m.index).replace(/[.\s:_-]+$/g, "").replace(/^\d+\s*x\s*/i, (q) => q).trim();
    if (!label) continue;
    let kind = "item";
    for (const [k, re] of KINDS) if (re.test(label)) { kind = k; break; }
    if (amount < 0 && kind === "item") kind = "credit";
    rows.push({ label, amount, kind });
  }
  return rows;
}

export function scan(text) {
  const rows = parseLines(text);
  const stated = [...rows].reverse().find((r) => r.kind === "total");
  const subtotal = rows.find((r) => r.kind === "subtotal");
  const parts = rows.filter((r) => !["total", "subtotal"].includes(r.kind));
  const sum = round(parts.reduce((s, r) => s + r.amount, 0));

  const flags = [];
  for (const r of rows) {
    if (r.kind === "total" || r.kind === "subtotal") continue;
    for (const [re, why, type] of SUSPICIOUS) {
      if (re.test(r.label)) { flags.push({ label: r.label, amount: r.amount, why, counts: type !== "rate" }); break; }
    }
  }
  // Duplicate lines (same label and amount).
  const seen = new Map();
  for (const r of rows) {
    if (r.kind === "total" || r.kind === "subtotal") continue;
    const key = r.label.toLowerCase().replace(/\s+/g, " ") + "|" + r.amount;
    if (seen.has(key)) flags.push({ label: r.label, amount: r.amount, why: "Appears twice — possible double charge.", counts: true });
    else seen.set(key, true);
  }

  let math = null;
  if (stated) {
    const diff = round(stated.amount - sum);
    math = { stated: stated.amount, sum, diff, ok: Math.abs(diff) < 0.02 };
  }
  const flaggedTotal = round(flags.filter((f) => f.counts).reduce((s, f) => s + Math.max(0, f.amount), 0));
  return { rows, flags, math, subtotal: subtotal?.amount ?? null, flaggedTotal };
}

export function round(n) { return Math.round(n * 100) / 100; }

// Privacy shield: mask long digit runs (cards, accounts), phones, emails and
// "acct"/"account" identifiers before any text is handed to a model.
export function redact(text) {
  let count = 0;
  const hit = (s) => { count++; return s; };
  let out = text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, () => hit("[email]"))
    .replace(/\b(\d{3})[-. ]?(\d{3})[-. ]?(\d{4})\b/g, () => hit("[phone]"))
    .replace(/((?:acct|account|member|policy|patient acct)[^\n:#]*(?:[:#]\s*)+)([A-Z0-9][A-Z0-9 -]{4,})/gi, (_, a) => a + hit("[account]"))
    .replace(/\b(?:\d[ -]?){12,19}\b/g, () => hit("[card/account]"))
    .replace(/(\*{2,}[ *]*)(\d{4})\b/g, () => hit("[card]"));
  return { text: out, count };
}

export const fmt = (n) => (n < 0 ? "−$" : "$") + Math.abs(n).toFixed(2);
