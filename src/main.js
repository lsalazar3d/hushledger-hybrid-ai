import "./style.css";
import { SAMPLES } from "./samples.js";
import { scan, redact, fmt, round } from "./rules.js";
import { initFirebase, deviceAvailability, warmDeviceModel, readBill, draftNote, isReady } from "./ai.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const state = { cfg: null, device: "unsupported", lastBill: null, lastScan: null, busy: false };
window.HUSHLEDGER = state; // handy for demos/tests

// ---------- status chips ----------
const DEVICE_TEXT = {
  available: ["On-device AI: Gemini Nano ready", "ok"],
  downloadable: ["On-device AI: model not downloaded", "warn"],
  downloading: ["On-device AI: downloading…", "warn"],
  unavailable: ["On-device AI: not available on this device", "off"],
  unsupported: ["On-device AI: this browser has no Prompt API", "off"],
};
function paintChips() {
  const [t, c] = DEVICE_TEXT[state.device] || DEVICE_TEXT.unavailable;
  setChip("chip-device", t, c);
  if (state.cfg?.configured) setChip("chip-cloud", `Cloud fallback: ${state.cfg.cloudModel} via Firebase AI Logic`, "ok");
  else setChip("chip-cloud", "Cloud fallback: Firebase not configured", "off");
  setChip("chip-net", navigator.onLine ? "Network: online" : "Network: offline", navigator.onLine ? "ok" : "warn");
  $("get-model").hidden = !(state.device === "downloadable" || state.device === "downloading");
}
function setChip(id, text, cls) { const el = $(id); el.textContent = text; el.className = "chip " + cls; }
addEventListener("online", paintChips);
addEventListener("offline", paintChips);

// ---------- samples ----------
for (const s of SAMPLES) {
  const b = document.createElement("button");
  b.className = "sample"; b.textContent = s.label; b.type = "button";
  b.onclick = () => { $("bill").value = s.text; updateShieldNote(); };
  $("samples").append(b);
}
$("bill").value = SAMPLES[0].text;

const mode = () => document.querySelector("input[name=mode]:checked").value;

function updateShieldNote() {
  const r = redact($("bill").value);
  $("shield-note").textContent = $("shield").checked
    ? (r.count ? `Privacy shield will mask ${r.count} identifier${r.count > 1 ? "s" : ""} before the AI sees this bill.` : "Privacy shield is on. Nothing to mask in this text.")
    : "Privacy shield is off. The AI will see the text exactly as pasted.";
}
$("bill").addEventListener("input", updateShieldNote);
$("shield").addEventListener("change", updateShieldNote);

// ---------- model download ----------
function showProgress(v) {
  $("dl").hidden = false;
  $("dl-bar").style.width = Math.round(v * 100) + "%";
  $("dl-text").textContent = `Downloading Gemini Nano… ${Math.round(v * 100)}%`;
  if (v >= 1) setTimeout(async () => { $("dl").hidden = true; state.device = await deviceAvailability(); paintChips(); }, 800);
}
$("get-model").onclick = () => { warmDeviceModel("prefer_on_device", showProgress); state.device = "downloading"; paintChips(); };

// ---------- render ----------
function srcBadge(el, where, ms) {
  if (where === "device") { el.className = "src src-device"; el.textContent = `On this device · Gemini Nano · ${ms} ms`; }
  else if (where === "cloud") { el.className = "src src-cloud"; el.textContent = `Cloud fallback · Gemini via Firebase AI Logic · ${ms} ms`; }
  else if (where === "busy") { el.className = "src src-busy"; el.textContent = "Thinking…"; }
  else { el.className = "src src-off"; el.textContent = where; }
}

function renderScan(s, red) {
  const math = s.math
    ? (s.math.ok
      ? `<p class="ok-line">✓ Lines add up to the stated total of <b>${fmt(s.math.stated)}</b>.</p>`
      : `<p class="bad-line">⚠ Lines add up to <b>${fmt(s.math.sum)}</b> but the bill says <b>${fmt(s.math.stated)}</b> (off by ${fmt(s.math.diff)}).</p>`)
    : `<p class="muted">No total line found.</p>`;
  const flags = s.flags.length
    ? `<ul class="flags">${s.flags.map((f) => `<li><span class="amt">${fmt(f.amount)}</span><b>${esc(f.label)}</b><small>${esc(f.why)}</small></li>`).join("")}</ul>`
    : `<p class="muted">No known junk-fee patterns found.</p>`;
  $("scan").innerHTML = `
    <div class="stats">
      <div><span>${s.rows.length}</span>lines with amounts</div>
      <div><span>${s.flags.length}</span>things to question</div>
      <div><span>${fmt(s.flaggedTotal)}</span>in flagged charges</div>
      <div><span>${red}</span>identifiers masked</div>
    </div>${math}${flags}`;
}

function renderAI(res, s) {
  const d = res.data || {};
  const items = d.items || [], fees = d.fees || [];
  const aiSum = round([...items, ...fees].reduce((a, x) => a + (Number(x.amount) || 0), 0));
  let check = "";
  if (s.math && typeof d.total === "number") {
    check = Math.abs(d.total - s.math.stated) < 0.02
      ? `<p class="ok-line">✓ AI total ${fmt(d.total)} matches the bill.</p>`
      : `<p class="bad-line">⚠ AI read the total as ${fmt(d.total)}, the bill says ${fmt(s.math.stated)}. Trust the bill.</p>`;
  }
  const order = { high: 0, medium: 1, low: 2 };
  fees.sort((a, b) => (order[a.risk] ?? 3) - (order[b.risk] ?? 3));
  $("ai").innerHTML = `
    <p class="summary"><b>${esc(d.merchant || "Bill")}</b> · ${esc(d.billType || "other")}<br>${esc(d.summary || "")}</p>
    ${check}
    <h4>Fees and charges to question</h4>
    ${fees.length ? `<ul class="fees">${fees.map((f) => `<li class="risk-${esc(f.risk)}"><span class="pill">${esc(f.risk)}</span><b>${esc(f.name)}</b><span class="amt">${fmt(Number(f.amount) || 0)}</span><small>${esc(f.why)}</small></li>`).join("")}</ul>` : `<p class="muted">The AI found no fees to question.</p>`}
    <details><summary>${items.length} regular line items (AI sum incl. fees ${fmt(aiSum)})</summary>
      <ul class="items">${items.map((i) => `<li><span>${esc(i.description)}</span><span>${fmt(Number(i.amount) || 0)}</span></li>`).join("")}</ul>
    </details>`;
  srcBadge($("ai-src"), res.where, res.ms);
}

function aiError(el, e, modeKey) {
  const msg = String(e?.message || e);
  console.warn(e);
  let nice = msg;
  if (modeKey === "only_on_device" || /on-device|ONLY_ON_DEVICE|device model|LanguageModel/i.test(msg)) nice = "Private-only mode: Gemini Nano isn't available in this browser, so nothing was sent anywhere. Switch to Hybrid to allow the cloud fallback.";
  else if (/app.?check|attestation|403|permission/i.test(msg)) nice = "The cloud fallback was refused (App Check / permissions). The instant scan above still works.";
  else if (/fetch|network|offline/i.test(msg)) nice = "You're offline and Gemini Nano isn't available here, so only the instant scan ran.";
  el.innerHTML = `<p class="bad-line">${esc(nice)}</p>`;
}

function logTrail(task, where, chars, masked, ms) {
  const ran = where === "device" ? `<span class="src src-device">on device</span>` : where === "cloud" ? `<span class="src src-cloud">cloud</span>` : where === "local" ? `<span class="src src-local">local JS · no AI</span>` : `<span class="src src-off">${esc(where)}</span>`;
  const sent = where === "device" ? "nothing (stayed in Chrome)" : where === "cloud" ? `${chars.toLocaleString()} chars to Gemini` : "nothing";
  const tr = document.createElement("tr");
  tr.innerHTML = `<td>${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</td><td>${esc(task)}</td><td>${ran}</td><td>${sent}</td><td>${masked}</td><td>${ms != null ? ms + " ms" : "—"}</td>`;
  $("trail").prepend(tr);
}

// ---------- main actions ----------
$("analyze").onclick = async () => {
  if (state.busy) return;
  const text = $("bill").value.trim();
  if (!text) return;
  state.busy = true; $("analyze").disabled = true;
  $("empty").hidden = true; $("out").hidden = false;

  const m = mode();
  if (isReady()) warmDeviceModel(m, state.device === "downloadable" ? showProgress : undefined); // user gesture

  const red = $("shield").checked ? redact(text) : { text, count: 0 };
  const s = scan(text);
  state.lastScan = s;
  renderScan(s, red.count);
  logTrail("Instant scan", "local", 0, "—", null);
  $("note").value = ""; $("copy").disabled = true; srcBadge($("note-src"), "not drafted yet");

  if (!isReady()) {
    srcBadge($("ai-src"), "AI off · Firebase not configured");
    $("ai").innerHTML = `<p class="muted">Add a Firebase config to turn on the hybrid AI read. The instant scan above ran fully on this device.</p>`;
    state.lastBill = { local: true, data: { merchant: "", fees: s.flags.filter((f) => f.counts).map((f) => ({ name: f.label, amount: f.amount, why: f.why, risk: "medium" })) } };
    $("draft").disabled = !state.lastBill.data.fees.length;
  } else {
    srcBadge($("ai-src"), "busy");
    $("ai").innerHTML = `<div class="skeleton"></div><div class="skeleton short"></div>`;
    try {
      const hints = s.flags.filter((f) => /twice/.test(f.why)).map((f) => `"${f.label}" (${fmt(f.amount)}) appears twice.`);
      const res = await readBill(red.text, m, hints);
      state.lastBill = res;
      renderAI(res, s);
      logTrail("Read bill", res.where, red.text.length, red.count, res.ms);
      $("draft").disabled = false;
    } catch (e) {
      srcBadge($("ai-src"), "no answer");
      aiError($("ai"), e, m);
      logTrail("Read bill", "not sent", 0, red.count, null);
      // still allow a note from the local scan
      state.lastBill = { local: true, data: { merchant: "", fees: s.flags.filter((f) => f.counts).map((f) => ({ name: f.label, amount: f.amount, why: f.why, risk: "medium" })) } };
      $("draft").disabled = !s.flags.length;
    }
  }
  state.busy = false; $("analyze").disabled = false;
  state.device = await deviceAvailability(); paintChips();
};

$("draft").onclick = async () => {
  const d = state.lastBill?.data; if (!d) return;
  const fees = (d.fees || []).filter((f) => f.risk !== "low");
  if (!fees.length) { $("note").value = "No medium or high risk charges to dispute."; return; }
  if (state.lastBill.local) {
    // No AI answer available: fill a plain template from the local scan, clearly labelled.
    $("note").value = templateNote(fees, $("tone").value); $("copy").disabled = false;
    srcBadge($("note-src"), "Template · no AI");
    logTrail("Dispute note", "local", 0, "placeholders", null);
    return;
  }
  $("draft").disabled = true; srcBadge($("note-src"), "busy");
  try {
    const res = await draftNote({ merchant: d.merchant, fees, tone: $("tone").value }, mode());
    $("note").value = res.text; $("copy").disabled = false;
    srcBadge($("note-src"), res.where, res.ms);
    logTrail("Dispute note", res.where, res.promptChars, "placeholders", res.ms);
  } catch (e) {
    srcBadge($("note-src"), "no answer");
    $("note").value = String(e?.message || e);
  }
  $("draft").disabled = false;
};

function templateNote(fees, tone) {
  const lines = fees.map((f) => `- ${f.name}: ${fmt(f.amount)}`).join("\n");
  const total = fmt(round(fees.reduce((a, f) => a + f.amount, 0)));
  const open = tone === "firm" ? "I am disputing the following charges on my latest bill" : "I'm writing about a few charges on my latest bill that I'd like reviewed";
  return `Hello,\n\n${open} (account [Account number]):\n${lines}\n\nTogether these come to ${total}. Please remove them or explain in writing what each one is for, and send me a corrected bill.\n\nThank you,\n[Your name]`;
}

$("copy").onclick = async () => {
  try { await navigator.clipboard.writeText($("note").value); $("copy").textContent = "Copied"; setTimeout(() => ($("copy").textContent = "Copy"), 1500); } catch {}
};

// ---------- boot ----------
(async () => {
  updateShieldNote();
  [state.cfg, state.device] = await Promise.all([initFirebase().catch((e) => ({ configured: false, reason: String(e) })), deviceAvailability()]);
  paintChips();
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("/sw.js").catch(() => {});
  document.body.dataset.ready = "1";
})();
