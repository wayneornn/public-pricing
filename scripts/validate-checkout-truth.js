import fs from "node:fs";
import path from "node:path";
import { providerConfigs } from "../src/connectors/index.js";
import { liveConnectors } from "../src/connectors/live.js";
import { isBrokerVisibleInventoryItem, isInterruptibleInventoryItem, updateStaleness } from "../src/core/inventory.js";
import {
  CHECKOUT_TRUTH_CONTRACTS,
  providerHasCheckoutTruthContract,
  validateCheckoutTruthItem,
  validateCheckoutTruthSnapshot
} from "../src/core/checkoutTruth.js";

const rootDir = path.resolve(import.meta.dirname, "..");
const env = loadEnv(path.join(rootDir, ".env"));
const startedAt = new Date();
const results = [];
const allRows = [];
const providerTimeoutMs = Number(env.CHECKOUT_TRUTH_PROVIDER_TIMEOUT_MS || 90_000);

for (const connector of liveConnectors) {
  const provider = providerConfigs.find((candidate) => candidate.id === connector.id) || connector;
  const contract = CHECKOUT_TRUTH_CONTRACTS[connector.id];
  const result = {
    providerId: connector.id,
    name: provider.name || connector.name,
    configured: connector.envVars.some((envVar) => hasEnvValue(env[envVar])),
    hasContract: providerHasCheckoutTruthContract(connector.id),
    rows: 0,
    orderable: 0,
    failures: [],
    warnings: [],
    durationMs: 0
  };

  if (!result.hasContract) {
    result.failures.push("No checkout truth contract exists for this live connector.");
    results.push(result);
    continue;
  }

  if (contract.mustNotDisplay) {
    result.status = "not_checkout_source";
    result.warnings.push(`${contract.source}; excluded from checkout inventory validation.`);
    results.push(result);
    continue;
  }

  if (!result.configured) {
    result.status = "missing_key";
    results.push(result);
    continue;
  }

  const started = Date.now();
  console.error(`[checkout-truth] ${result.name}: fetching live checkout inventory...`);
  try {
    const rows = await withTimeout(connector.fetch(env), providerTimeoutMs, result.name);
    result.durationMs = Date.now() - started;
    result.rows = rows.length;
    result.orderable = rows.filter((item) => item.orderable).length;
    allRows.push(...rows);
    for (const row of rows) {
      const validation = validateCheckoutTruthItem(row);
      result.failures.push(...validation.failures);
      result.warnings.push(...validation.warnings);
    }
    result.status = result.failures.length ? "failed" : "passed";
    console.error(`[checkout-truth] ${result.name}: ${result.status} (${result.orderable}/${result.rows} orderable, ${result.durationMs}ms)`);
  } catch (error) {
    result.durationMs = Date.now() - started;
    result.status = "error";
    result.failures.push(error.message);
    console.error(`[checkout-truth] ${result.name}: error (${error.message})`);
  }
  results.push(result);
}

const now = new Date();
const snapshotItems = allRows.map((item) => updateStaleness(item, now)).filter(isBrokerVisibleInventoryItem);
const snapshotProviderHealth = results.map((result) => ({
  id: result.providerId,
  itemCount: allRows.filter((item) => item.providerId === result.providerId && isBrokerVisibleInventoryItem(item)).length,
  rawItemCount: result.rows,
  status: result.status
}));
const snapshotValidation = validateCheckoutTruthSnapshot(snapshotItems, snapshotProviderHealth);
const nonOrderableDisplayed = snapshotItems.filter((item) => !item.orderable);
const providerConsoleDisplayed = snapshotItems.filter((item) => item.checkoutSemantics === "provider_console");
const manualProviderDisplayed = snapshotItems.filter((item) => item.checkoutSemantics === "manual_provider");
const interruptibleDisplayed = snapshotItems.filter(isInterruptibleInventoryItem);

const summary = {
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  totals: {
    providers: results.length,
    configured: results.filter((result) => result.configured).length,
    passed: results.filter((result) => result.status === "passed").length,
    failed: results.filter((result) => ["failed", "error"].includes(result.status)).length,
    missingKey: results.filter((result) => result.status === "missing_key").length,
    notCheckoutSource: results.filter((result) => result.status === "not_checkout_source").length,
    rows: results.reduce((sum, result) => sum + result.rows, 0),
    orderable: results.reduce((sum, result) => sum + result.orderable, 0),
    displayedRows: snapshotItems.length,
    nonOrderableDisplayed: nonOrderableDisplayed.length,
    manualProviderDisplayed: manualProviderDisplayed.length,
    providerConsoleDisplayed: providerConsoleDisplayed.length,
    interruptibleDisplayed: interruptibleDisplayed.length
  },
  providers: results.map((result) => ({
    ...result,
    warningCount: result.warnings.length,
    failureCount: result.failures.length,
    warnings: result.warnings.slice(0, 25),
    failures: result.failures.slice(0, 25)
  })),
  appSnapshot: {
    mode: "live",
    displayedRows: snapshotItems.length,
    nonOrderableDisplayed: nonOrderableDisplayed.map((item) => `${item.providerId}:${item.rawOfferId}`).slice(0, 25),
    manualProviderDisplayed: manualProviderDisplayed.map((item) => `${item.providerId}:${item.rawOfferId}`).slice(0, 25),
    providerConsoleDisplayed: providerConsoleDisplayed.map((item) => `${item.providerId}:${item.rawOfferId}`).slice(0, 25),
    interruptibleDisplayed: interruptibleDisplayed.map((item) => `${item.providerId}:${item.rawOfferId}`).slice(0, 25),
    failures: snapshotValidation.failures.slice(0, 50),
    warnings: snapshotValidation.warnings.slice(0, 50),
    failureCount: snapshotValidation.failures.length,
    warningCount: snapshotValidation.warnings.length
  }
};

console.log(JSON.stringify(summary, null, 2));

if (
  results.some((result) => ["failed", "error"].includes(result.status))
  || snapshotValidation.failures.length
  || nonOrderableDisplayed.length
  || providerConsoleDisplayed.length
  || interruptibleDisplayed.length
) {
  process.exitCode = 1;
}

async function withTimeout(promise, timeoutMs, label) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} checkout validation timed out after ${timeoutMs}ms`)), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function loadEnv(filePath) {
  const loaded = { ...process.env };
  if (!fs.existsSync(filePath)) return loaded;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    loaded[trimmed.slice(0, index)] = trimmed.slice(index + 1).replace(/^"|"$/g, "");
  }
  return loaded;
}

function hasEnvValue(value) {
  if (value === null || value === undefined) return false;
  const normalized = String(value).trim().toLowerCase();
  return Boolean(normalized) && !["0", "false", "no", "off"].includes(normalized);
}
