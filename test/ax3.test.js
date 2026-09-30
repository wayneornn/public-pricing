import assert from "node:assert/strict";
import test from "node:test";
import { ax3HtmlToItems, extractAx3PriceRows } from "../src/connectors/live/providers/ax3.js";

const HTML = `
<div class="tr">
  <div class="prce_txt">Starting at $4.40/hr*</div>
  <div class="prce_txt">Starting at $3.75/hr*</div>
  <div class="prce_txt">Starting at $2.50/hr*</div>
  <div class="prce_txt">Starting at $2.35/hr*</div>
  <div class="prce_txt">Starting at $2.35/hr*</div>
</div>
<div class="tr">
  <div>GB300<br/>Available Now</div>
  <div>B300<br/>Available Now</div>
  <div>H200<br/>Available Now</div>
  <div>H100<br/>Available Now</div>
  <div>MI3XX<br/>Available Now</div>
</div>`;

test("Ax3 pairs model headers with starting hourly prices", () => {
  const rows = extractAx3PriceRows(HTML);
  assert.deepEqual(rows.map((row) => row.model), ["GB300", "B300", "H200", "H100", "MI3XX"]);
  assert.equal(rows[2].pricePerGpuHour, 2.5);
});

test("Ax3 rows are non-orderable USD price catalog", () => {
  const items = ax3HtmlToItems(HTML);
  const h100 = items.find((item) => item.rawOfferId === "ax3:h100");
  assert.equal(h100.pricePerGpuHour, 2.35);
  assert.equal(h100.currency, "USD");
  assert.equal(h100.checkoutSemantics, "provider_console");
  assert.equal(h100.orderable, false);
});
