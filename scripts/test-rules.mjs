// Quick checks for the local (no-AI) scanner and privacy shield: `npm test`
import assert from "node:assert/strict";
import { scan, redact } from "../src/rules.js";
import { SAMPLES } from "../src/samples.js";
for (const s of SAMPLES) {
  const r = scan(s.text);
  assert.ok(r.math && r.math.ok, `${s.id}: lines should add up to the stated total`);
  assert.ok(r.flags.length > 0, `${s.id}: should flag something`);
}
assert.ok(scan(SAMPLES[2].text).flags.some((f) => /twice/.test(f.why)), "clinic duplicate test should be caught");
const red = redact(SAMPLES[0].text).text;
assert.ok(!/8841 2290/.test(red) && !/555-013/.test(red) && !/@brightwave/.test(red), "shield masks account, phone, email");
console.log("rules: all checks passed");
