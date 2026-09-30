const state = {
  items: [],
  sortKey: "pricePerGpuHour",
  sortDir: "asc"
};

const rowsEl = document.getElementById("rows");
const countEl = document.getElementById("count");
const gpuFilter = document.getElementById("gpuFilter");
const regionFilter = document.getElementById("regionFilter");
const maxPriceFilter = document.getElementById("maxPriceFilter");
const providerFilter = document.getElementById("providerFilter");
const orderableOnly = document.getElementById("orderableOnly");
let gpuChosen = false;

const HYPERSCALERS = new Set(["aws", "azure", "google-cloud", "oci"]);

for (const button of document.querySelectorAll("th button[data-sort]")) {
  button.addEventListener("click", () => {
    const key = button.dataset.sort;
    if (state.sortKey === key) {
      state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
    } else {
      state.sortKey = key;
      state.sortDir = "asc";
    }
    syncSortHeaders();
    render();
  });
}

for (const control of [gpuFilter, regionFilter, maxPriceFilter, providerFilter, orderableOnly]) {
  control.addEventListener("input", () => {
    fitSelect(control);
    render();
  });
  control.addEventListener("change", () => {
    if (control === gpuFilter) gpuChosen = true;
    fitSelect(control);
    render();
  });
}

syncSortHeaders();
load();

async function load() {
  try {
    const response = await fetch("/api/inventory");
    const payload = await response.json();
    state.items = Array.isArray(payload.items) ? payload.items : [];
    fillSelect(gpuFilter, state.items.map((item) => item.gpuModel), "All GPUs");
    fillSelect(regionFilter, state.items.map((item) => item.region), "All regions");
    fillSelect(providerFilter, state.items.map((item) => item.provider), "All providers");
    render();
  } catch {
    countEl.textContent = "";
    rowsEl.innerHTML = `<tr class="empty"><td colspan="7">Unavailable</td></tr>`;
  }
}

function fillSelect(select, values, allLabel) {
  const selected = select.value;
  const names = [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: "base"
  }));
  select.replaceChildren(new Option(allLabel, ""));
  for (const name of names) select.append(new Option(name, name));
  if (select === gpuFilter && !gpuChosen && names.includes("H100")) {
    select.value = "H100";
  } else if (names.includes(selected)) {
    select.value = selected;
  }
  fitSelect(select);
}

function fitSelect(select) {
  if (select.tagName !== "SELECT") return;
  const label = select.options[select.selectedIndex]?.text || "";
  const probe = fitSelect.probe || (fitSelect.probe = document.createElement("span"));
  const style = getComputedStyle(select);
  probe.textContent = label;
  probe.style.cssText = "position:absolute;left:-9999px;top:0;visibility:hidden;white-space:nowrap;";
  probe.style.font = style.font;
  probe.style.fontVariantNumeric = style.fontVariantNumeric;
  probe.style.letterSpacing = style.letterSpacing;
  if (!probe.isConnected) document.body.append(probe);
  const textWidth = Math.ceil(probe.getBoundingClientRect().width);
  select.style.width = `${textWidth + 46}px`;
}

function render() {
  const visible = state.items.filter(matchesFilters).sort(compareItems);
  countEl.textContent = String(visible.length);
  if (!visible.length) {
    rowsEl.innerHTML = `<tr class="empty"><td colspan="7">No prices</td></tr>`;
    return;
  }
  rowsEl.innerHTML = visible.map(rowHtml).join("");
}

function matchesFilters(item) {
  if (numericPrice(item.pricePerGpuHour) == null && numericPrice(item.totalHourlyPrice) == null) return false;
  if (gpuFilter.value && item.gpuModel !== gpuFilter.value) return false;
  if (regionFilter.value && item.region !== regionFilter.value) return false;
  const max = Number(maxPriceFilter.value);
  if (maxPriceFilter.value !== "" && Number.isFinite(max)) {
    const price = Number(item.pricePerGpuHour);
    if (!Number.isFinite(price) || price > max) return false;
  }
  if (providerFilter.value && item.provider !== providerFilter.value) return false;
  if (orderableOnly.checked && !hasOrderLink(item)) return false;
  return true;
}

function hasOrderLink(item) {
  return Boolean(item.checkoutUrl) && ["exact_listing", "prefilled_deploy"].includes(item.checkoutSemantics);
}

function compareItems(left, right) {
  const key = state.sortKey;
  const primary = compareValues(sortValue(left, key), sortValue(right, key), state.sortDir);
  if (primary !== 0) return primary;
  return compareValues(left.provider, right.provider, "asc")
    || compareValues(configurationText(left), configurationText(right), "asc")
    || compareValues(numericPrice(left.pricePerGpuHour), numericPrice(right.pricePerGpuHour), "asc");
}

function sortValue(item, key) {
  if (key === "configuration") return configurationText(item);
  if (key === "availability") {
    if (Number.isFinite(Number(item.availabilityCount))) return Number(item.availabilityCount);
    if (item.availability === "available") return 0;
    return null;
  }
  if (key === "pricePerGpuHour" || key === "totalHourlyPrice") return numericPrice(item[key]);
  return item[key] || "";
}

function compareValues(left, right, direction) {
  const factor = direction === "desc" ? -1 : 1;
  const leftMissing = left == null || left === "";
  const rightMissing = right == null || right === "";
  if (leftMissing && rightMissing) return 0;
  if (leftMissing) return 1;
  if (rightMissing) return -1;
  if (typeof left === "number" && typeof right === "number") return (left - right) * factor;
  return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" }) * factor;
}

function syncSortHeaders() {
  for (const button of document.querySelectorAll("th button[data-sort]")) {
    const active = button.dataset.sort === state.sortKey;
    const arrow = button.querySelector(".arrow");
    if (active) {
      button.setAttribute("aria-sort", state.sortDir === "asc" ? "ascending" : "descending");
      if (arrow) arrow.textContent = state.sortDir === "asc" ? "↑" : "↓";
    } else {
      button.removeAttribute("aria-sort");
      if (arrow) arrow.textContent = "";
    }
  }
}

function rowHtml(item) {
  const tags = [];
  if (isGpuOnly(item)) tags.push("GPU only");
  if (item.marketType === "spot" || item.priceSemantics === "spot") tags.push("Spot");
  const tagHtml = tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("");
  const hyperscaler = HYPERSCALERS.has(item.providerId) ? " hyperscaler" : "";
  return `<tr class="${hyperscaler.trim()}">
    <td class="provider">${escapeHtml(item.provider || "")}</td>
    <td class="tight">${escapeHtml(configurationText(item))}</td>
    <td>${escapeHtml(item.region || "—")}</td>
    <td class="num tight">${tagHtml}${formatMoney(item.pricePerGpuHour, item.currency)}</td>
    <td class="num tight">${formatMoney(item.totalHourlyPrice, item.currency)}</td>
    <td class="num">${escapeHtml(availabilityText(item))}</td>
    <td class="order">${orderHtml(item)}</td>
  </tr>`;
}

function configurationText(item) {
  const count = Number(item.gpuCount);
  const countLabel = Number.isFinite(count) && count > 0 ? `${count}× ` : "";
  const variant = item.gpuVariant && item.gpuVariant !== "Unknown" ? ` ${item.gpuVariant}` : "";
  const vram = Number(item.vramGbEach) > 0 ? ` ${item.vramGbEach}GB` : "";
  return `${countLabel}${item.gpuModel || ""}${variant}${vram}`.trim();
}

function availabilityText(item) {
  if (Number.isFinite(Number(item.availabilityCount)) && Number(item.availabilityCount) > 0) {
    return String(item.availabilityCount);
  }
  if (item.availability === "available") return "Yes";
  return "—";
}

function orderHtml(item) {
  if (!item.checkoutUrl) return `<span class="muted">—</span>`;
  if (!["exact_listing", "prefilled_deploy"].includes(item.checkoutSemantics)) return `<span class="muted">—</span>`;
  return `<a class="order" href="${escapeAttribute(item.checkoutUrl)}" target="_blank" rel="noreferrer">Order</a>`;
}

function isGpuOnly(item) {
  return item.priceSemantics === "gpu_only"
    || item.priceSemantics === "lowest_sku"
    || item.priceScope === "gpu_sku_only"
    || item.priceScope === "gpu_sku_lowest";
}

function numericPrice(value) {
  if (value == null || value === "") return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

function formatMoney(value, currency = "USD") {
  const amount = numericPrice(value);
  if (amount == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}
