import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import dotenv from "dotenv";
import express from "express";
import { providerConfigs } from "./connectors/index.js";
import { createInventoryStore } from "./store.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");

dotenv.config({ path: path.join(rootDir, ".env"), quiet: true });

export function createAppServer({ env = process.env, connectors, initialItems, initialProviderHealth } = {}) {
  const store = createInventoryStore({ env, connectors, initialItems, initialProviderHealth });

  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use((_request, response, next) => {
    response.set("Cache-Control", "no-store");
    next();
  });

  app.get("/api/inventory", async (request, response) => {
    await store.hydrate();
    const snapshot = store.snapshot();
    if (request.query.refresh === "1") {
      await store.refresh({ force: true });
    } else if (!snapshot.lastRefreshAt && !snapshot.isRefreshing) {
      store.refresh().catch((error) => {
        console.error(`inventory refresh failed: ${error.message}`);
      });
    }
    response.json(publicSnapshot(store.snapshot()));
  });

  app.post("/api/search", async (request, response) => {
    await store.hydrate();
    response.json(publicSearch(store.search(request.body)));
  });

  app.post("/api/checkout/revalidate", async (request, response) => {
    if (!request.body.id) return response.status(400).json({ ok: false, error: "missing offer id" });
    const result = await store.revalidateCheckout({ id: request.body.id });
    response.status(result.ok ? 200 : 409).json({
      ...result,
      item: result.item ? publicItem(result.item) : null
    });
  });

  app.get("/api/providers", async (_request, response) => {
    await store.hydrate();
    response.json({
      providers: providerConfigs,
      health: store.snapshot().providerHealth
    });
  });

  app.post("/api/refresh", async (_request, response) => {
    await store.refresh({ force: true });
    response.json(publicSnapshot(store.snapshot()));
  });

  app.use(express.static(publicDir, {
    setHeaders(response) {
      response.setHeader("Cache-Control", "no-store");
    }
  }));

  app.use((_request, response) => {
    response.status(404).send("Not found");
  });

  // Express identifies error handlers by their four-argument arity, so `next`
  // must stay in the signature even though it is unused.
  app.use((error, _request, response, _next) => {
    response.status(500).json({ error: error.message });
  });

  const server = http.createServer(app);
  return { server, store };
}

export function startServerFromEnv(env = process.env) {
  const port = Number(env.PORT || 4180);
  const refreshIntervalSeconds = Number(env.REFRESH_INTERVAL_SECONDS || 5);
  const { server, store } = createAppServer({ env });

  server.listen(port, "0.0.0.0", () => {
    console.log(`Prices running at http://localhost:${port}`);
    console.log(`Inventory mode: ${store.snapshot().mode}`);
    startRefreshLoop(store, {
      intervalSeconds: refreshIntervalSeconds,
      logger: console
    });
  });

  return { server, store };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  startServerFromEnv();
}

export function startRefreshLoop(store, { intervalSeconds = 5, logger = console } = {}) {
  let stopped = false;
  const restMs = Math.max(1000, Number(intervalSeconds || 0) * 1000);

  async function loop() {
    await store.hydrate().catch((error) => {
      logger.error?.(`inventory snapshot hydrate failed: ${error.message}`);
    });
    while (!stopped) {
      const startedAt = Date.now();
      let latestSnapshot = store.snapshot();
      try {
        latestSnapshot = await store.refresh();
      } catch (error) {
        logger.error?.(`inventory refresh failed: ${error.message}`);
        latestSnapshot = store.snapshot();
      }
      const elapsedMs = Date.now() - startedAt;
      const errorSuffix = latestSnapshot.lastError ? `; last error: ${latestSnapshot.lastError}` : "";
      logger.log?.(`inventory refresh cycle complete in ${Math.round(elapsedMs / 1000)}s with ${latestSnapshot.count} offers; next crawl in ${Math.round(restMs / 1000)}s${errorSuffix}`);
      await sleep(restMs);
    }
  }

  const done = loop();
  return {
    stop() {
      stopped = true;
    },
    done
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function publicSnapshot(snapshot) {
  return {
    ...snapshot,
    items: (snapshot.items || []).map(publicItem)
  };
}

function publicSearch(payload) {
  const results = (payload.results || []).map(publicItem);
  return {
    spec: payload.spec,
    results,
    bestOverall: payload.bestOverall ? publicItem(payload.bestOverall) : null,
    count: results.length
  };
}

function publicItem(item) {
  return {
    id: item.id,
    provider: item.provider,
    providerId: item.providerId,
    gpuCount: item.gpuCount,
    gpuModel: item.gpuModel,
    gpuVariant: item.gpuVariant,
    gpuTier: item.gpuTier,
    vramGbEach: item.vramGbEach,
    region: item.region,
    formFactor: item.formFactor,
    networkFabric: item.networkFabric,
    interconnect: item.interconnect,
    pricePerGpuHour: item.pricePerGpuHour,
    totalHourlyPrice: item.totalHourlyPrice,
    currency: item.currency,
    availability: item.availability,
    availabilityCount: item.availabilityCount,
    checkoutUrl: directCheckoutUrl(item),
    checkoutSemantics: item.checkoutSemantics,
    priceSemantics: item.priceSemantics,
    priceScope: item.priceScope,
    marketType: item.marketType,
    orderable: item.orderable
  };
}

function directCheckoutUrl(item) {
  if (!item?.checkoutUrl) return null;
  if (!["exact_listing", "prefilled_deploy"].includes(item.checkoutSemantics)) return null;
  return item.checkoutUrl;
}
