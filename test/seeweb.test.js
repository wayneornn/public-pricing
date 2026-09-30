import assert from "node:assert/strict";
import test from "node:test";
import { seewebHtmlToItems } from "../src/connectors/live/providers/seeweb.js";

// Fixture mirrors the real product-page card structure (verified live): a "CLOUD GPU
// <model>" card title followed by config selectors and "Hourly Cost <price> €".
function card(model, price) {
  return `<div class="cardType">CLOUD GPU ${model}</div><span>1</span><span>2</span><span>4</span> Configuration ... <strong>Hourly Cost ${price} €</strong> 3 mths: ${price} €/hr`;
}

test("Seeweb parser pairs each GPU card with its hourly EUR price (->USD)", () => {
  const html = [
    card("NVIDIA H100", "1.89"),
    card("NVIDIA A100", "0.99"),
    card("AMD MI300X", "2.35"),
    card("NVIDIA L40S", "0.85")
  ].join("\n");
  const rows = seewebHtmlToItems(html);

  assert.equal(rows.length, 4);
  const byModel = Object.fromEntries(rows.map((r) => [r.gpuModel, r]));

  assert.equal(byModel.H100.providerId, "seeweb");
  assert.equal(byModel.H100.nativeCurrency, "EUR");
  assert.equal(byModel.H100.currency, "USD");
  assert.equal(byModel.H100.totalHourlyPrice, round(1.89 * 1.08)); // EUR->USD FX
  assert.equal(byModel.H100.region, "Seeweb (IT)");
  assert.equal(byModel.H100.country, "IT");
  assert.equal(byModel.H100.orderable, false);

  assert.equal(byModel.A100.nativePricePerGpuHour, 0.99);
  assert.equal(byModel.MI300X.nativePricePerGpuHour, 2.35);
  assert.equal(byModel.L40S.nativePricePerGpuHour, 0.85);
});

test("Seeweb parser detects models from truncated card titles", () => {
  const rows = seewebHtmlToItems([
    card("NVIDIA RTX PRO", "1.25"),
    card("NVIDIA Quadro RTX", "0.29"),
    card("NVIDIA L4", "0.38")
  ].join("\n"));
  const models = rows.map((r) => r.gpuModel).sort();
  assert.ok(models.includes("RTX PRO 6000"));
  assert.ok(models.includes("L4"));
});

test("Seeweb parser returns [] when no GPU cards are present", () => {
  assert.deepEqual(seewebHtmlToItems("<html>nothing here</html>"), []);
});

function round(value) {
  return Math.round(value * 10000) / 10000;
}
