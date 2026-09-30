import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_FILE_PATH = ".cache/inventory-snapshot.json";
const DEFAULT_GCS_OBJECT = "inventory/latest.json";
const METADATA_TOKEN_URL = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";

export function createInventorySnapshotStore({
  env = process.env,
  fetcher = globalThis.fetch,
  logger = console
} = {}) {
  const mode = String(env.INVENTORY_SNAPSHOT_STORE || "off").trim().toLowerCase();

  async function load() {
    if (!isEnabled(mode)) return null;
    try {
      const payload = mode === "gcs"
        ? await readGcsSnapshot(env, fetcher)
        : await readFileSnapshot(env);
      return normalizeSnapshotPayload(payload);
    } catch (error) {
      logger.warn?.(`Inventory snapshot load failed: ${error.message}`);
      return null;
    }
  }

  async function save(snapshot) {
    if (!isEnabled(mode)) return false;
    try {
      const payload = {
        version: 1,
        savedAt: new Date().toISOString(),
        snapshot: normalizeSnapshotForStorage(snapshot)
      };
      if (mode === "gcs") {
        await writeGcsSnapshot(env, fetcher, payload);
      } else {
        await writeFileSnapshot(env, payload);
      }
      return true;
    } catch (error) {
      logger.warn?.(`Inventory snapshot save failed: ${error.message}`);
      return false;
    }
  }

  return {
    mode,
    enabled: isEnabled(mode),
    load,
    save
  };
}

function isEnabled(mode) {
  return ["file", "gcs"].includes(mode);
}

async function readFileSnapshot(env) {
  const filePath = path.resolve(process.cwd(), env.INVENTORY_SNAPSHOT_FILE || DEFAULT_FILE_PATH);
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeFileSnapshot(env, payload) {
  const filePath = path.resolve(process.cwd(), env.INVENTORY_SNAPSHOT_FILE || DEFAULT_FILE_PATH);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(payload)}\n`);
  await fs.rename(tmpPath, filePath);
}

async function readGcsSnapshot(env, fetcher) {
  const bucket = required(env.INVENTORY_SNAPSHOT_GCS_BUCKET, "INVENTORY_SNAPSHOT_GCS_BUCKET");
  const object = env.INVENTORY_SNAPSHOT_GCS_OBJECT || DEFAULT_GCS_OBJECT;
  const token = await googleAccessToken(env, fetcher);
  const response = await fetchWithTimeout(
    fetcher,
    `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(object)}?alt=media`,
    {
      headers: { Authorization: `Bearer ${token}` },
      timeoutMs: Number(env.INVENTORY_SNAPSHOT_TIMEOUT_MS || 5000)
    }
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GCS snapshot read returned ${response.status}`);
  return response.json();
}

async function writeGcsSnapshot(env, fetcher, payload) {
  const bucket = required(env.INVENTORY_SNAPSHOT_GCS_BUCKET, "INVENTORY_SNAPSHOT_GCS_BUCKET");
  const object = env.INVENTORY_SNAPSHOT_GCS_OBJECT || DEFAULT_GCS_OBJECT;
  const token = await googleAccessToken(env, fetcher);
  const response = await fetchWithTimeout(
    fetcher,
    `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(object)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      timeoutMs: Number(env.INVENTORY_SNAPSHOT_TIMEOUT_MS || 5000)
    }
  );
  if (!response.ok) throw new Error(`GCS snapshot write returned ${response.status}`);
}

async function googleAccessToken(env, fetcher) {
  if (env.INVENTORY_SNAPSHOT_GCS_ACCESS_TOKEN) return env.INVENTORY_SNAPSHOT_GCS_ACCESS_TOKEN;
  if (env.GCP_ACCESS_TOKEN) return env.GCP_ACCESS_TOKEN;
  const response = await fetchWithTimeout(fetcher, METADATA_TOKEN_URL, {
    headers: { "Metadata-Flavor": "Google" },
    timeoutMs: Number(env.INVENTORY_SNAPSHOT_TIMEOUT_MS || 5000)
  });
  if (!response.ok) throw new Error(`metadata token request returned ${response.status}`);
  const payload = await response.json();
  return required(payload.access_token, "metadata access_token");
}

async function fetchWithTimeout(fetcher, url, options = {}) {
  if (!fetcher) throw new Error("fetch is unavailable");
  const timeoutMs = options.timeoutMs || 5000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const { timeoutMs: _timeoutMs, ...fetchOptions } = options;
    return await fetcher(url, { ...fetchOptions, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeSnapshotPayload(payload) {
  if (!payload) return null;
  const snapshot = payload.snapshot || payload;
  if (!snapshot || !Array.isArray(snapshot.items)) return null;
  return {
    items: snapshot.items,
    providerHealth: Array.isArray(snapshot.providerHealth) ? snapshot.providerHealth : [],
    mode: snapshot.mode || "live",
    lastRefreshAt: snapshot.lastRefreshAt || payload.savedAt || null,
    lastError: snapshot.lastError || null,
    savedAt: payload.savedAt || snapshot.savedAt || null
  };
}

function normalizeSnapshotForStorage(snapshot) {
  return {
    items: Array.isArray(snapshot.items) ? snapshot.items : [],
    providerHealth: Array.isArray(snapshot.providerHealth) ? snapshot.providerHealth : [],
    mode: snapshot.mode || "live",
    lastRefreshAt: snapshot.lastRefreshAt || null,
    lastError: snapshot.lastError || null,
    count: Number(snapshot.count || snapshot.items?.length || 0)
  };
}

function required(value, name) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${name} is required`);
  return text;
}
