import assert from "node:assert/strict";
import test from "node:test";
import { extractSlydCards, slydHtmlToItems } from "../src/connectors/live/providers/slyd.js";

const HTML = `
<div class="slyd-server-card"><div class="slyd-server-card__glow"></div>
  <span class="slyd-server-card__status-text">AVAILABLE NOW</span>
  <div class="slyd-server-card__tier slyd-server-card__tier--2">Tier 2</div>
  <h3 class="slyd-server-card__title">1x RTX A6000</h3>
  <p class="slyd-server-card__category">Professional Workstation</p>
  <div class="slyd-server-card__spec-label">GPU Configuration</div>
  <div class="slyd-server-card__spec-value">1x RTX A6000</div>
  <div class="slyd-server-card__spec-label">Video Memory</div>
  <div class="slyd-server-card__spec-value">48 GB VRAM</div>
  <div class="slyd-server-card__spec-label">CPU Cores</div>
  <div class="slyd-server-card__spec-value">6 Cores</div>
  <div class="slyd-server-card__spec-label">System RAM</div>
  <div class="slyd-server-card__spec-value">24 GB RAM</div>
  <div class="slyd-server-card__location"><svg></svg>Kansas City, MO</div>
  <span class="slyd-server-card__price-amount">$0.50</span>
  <span class="slyd-server-card__price-unit">/hour</span>
  <a href="/Account/Login?redirectUri=/consumer/compute-marketplace&amp;gpu=rtx-a6000" class="slyd-server-card__button">Deploy Server</a>
</div>
<div class="compute-more-gpus"></div>`;

test("SLYD extracts server-rendered marketplace cards", () => {
  const cards = extractSlydCards(HTML);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].title, "1x RTX A6000");
  assert.equal(cards[0].location, "Kansas City, MO");
  assert.equal(cards[0].pricePerGpuHour, 0.5);
});

test("SLYD maps cards to non-orderable available catalog rows", () => {
  const [item] = slydHtmlToItems(HTML);
  assert.equal(item.providerId, "slyd");
  assert.equal(item.gpuLabel, "1x RTX A6000 48GB");
  assert.equal(item.availability, "available");
  assert.equal(item.cpu, "6 Cores");
  assert.equal(item.ramGb, 24);
  assert.match(item.checkoutUrl, /gpu=rtx-a6000/);
  assert.equal(item.checkoutSemantics, "provider_console");
  assert.equal(item.orderable, false);
});
