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
const refreshButton = document.getElementById("refreshButton");

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

for (const input of [gpuFilter, regionFilter, maxPriceFilter, providerFilter]) {
  input.addEventListener("input", render);
}

refreshButton.addEventListener("click", () => load({ refresh: true }));

syncSortHeaders();
load();
setInterval(() => load(), 20000);

async function load({ refresh = false } = {}) {
  if (refresh) {
    refreshButton.disabled = true;
    refreshButton.textContent = "Refreshing";
  }
  try {
    const response = await fetch(refresh ? "/api/inventory?refresh=1" : "/api/inventory");
    const payload = await response.json();
    state.items = Array.isArray(payload.items) ? payload.items : [];
    fillProviders(state.items);
    render();
  } catch {
    countEl.textContent = "";
    rowsEl.innerHTML = `<tr class="empty"><td colspan="7">Unavailable</td></tr>`;
  } finally {
    if (refresh) {
      refreshButton.disabled = false;
      refreshButton.textContent = "Refresh";
    }
  }
}

function fillProviders(items) {
  const selected = providerFilter.value;
  const names = [...new Set(items.map((item) => item.provider).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  providerFilter.replaceChildren(new Option("All providers", ""));
  for (const name of names) providerFilter.append(new Option(name, name));
  if (names.includes(selected)) providerFilter.value = selected;
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
  const gpu = gpuFilter.value.trim().toLowerCase();
  if (gpu) {
    const haystack = `${item.gpuModel || ""} ${item.gpuVariant || ""} ${item.gpuCount || ""}`.toLowerCase();
    if (!haystack.includes(gpu)) return false;
  }
  const region = regionFilter.value.trim().toLowerCase();
  if (region && !String(item.region || "").toLowerCase().includes(region)) return false;
  const max = Number(maxPriceFilter.value);
  if (maxPriceFilter.value !== "" && Number.isFinite(max)) {
    const price = Number(item.pricePerGpuHour);
    if (!Number.isFinite(price) || price > max) return false;
  }
  if (providerFilter.value && item.provider !== providerFilter.value) return false;
  return true;
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
  return `<tr>
    <td class="provider">${escapeHtml(item.provider || "")}</td>
    <td>${escapeHtml(configurationText(item))}</td>
    <td>${escapeHtml(item.region || "—")}</td>
    <td class="num price">${tagHtml}${formatMoney(item.pricePerGpuHour, item.currency)}</td>
    <td class="num">${formatMoney(item.totalHourlyPrice, item.currency)}</td>
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
