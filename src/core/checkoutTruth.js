export const CHECKOUT_TRUTH_CONTRACTS = {
  "runpod": {
    source: "Runpod GraphQL gpuTypes.lowestPrice",
    checkoutSemantics: ["manual_provider"],
    checkoutUrlRules: [
      { semantics: "manual_provider", host: "www.runpod.io", path: /^\/console\/gpu-cloud\/?$/, requiredParams: ["gpuTypeId"] }
    ],
    validate(item, fail) {
      const raw = item.rawPayload || {};
      requirePositive(fail, item, "lowestPrice.uninterruptablePrice", raw.lowestPrice?.uninterruptablePrice);
      requireAvailableStock(fail, item, raw.lowestPrice?.stockStatus);
    }
  },
  "vast-ai": {
    source: "Vast.ai bundles filtered for rentable=true and rented=false",
    checkoutSemantics: ["exact_listing"],
    checkoutUrlRules: [
      { semantics: "exact_listing", host: "cloud.vast.ai", path: /^\/create\/?$/, requiredParams: ["id", "offer_id", "ask_id"] }
    ],
    validate(item, fail) {
      const raw = item.rawPayload || {};
      requirePositive(fail, item, "dph_total/dph_base", raw.dph_total || raw.dph_base || raw.price_per_hour);
      if (raw.rentable === false) fail(item, "raw rentable=false");
      if (raw.rented === true) fail(item, "raw rented=true");
      if (!raw.id && !raw.ask_contract_id) fail(item, "missing exact Vast offer id");
    }
  },
  "shadeform": {
    source: "Shadeform instance types with available=true",
    checkoutSemantics: ["manual_provider"],
    checkoutUrlRules: [
      { semantics: "manual_provider", host: "www.shadeform.ai", path: /^\/?$/, requiredParams: ["cloud", "shade_instance_type", "region"] }
    ],
    validate(item, fail) {
      const raw = item.rawPayload || {};
      requirePositive(fail, item, "hourly_price", raw.hourly_price);
      if (item.metadata?.providerAvailability?.available === false) fail(item, "providerAvailability.available=false");
    }
  },
  "prime-intellect": {
    source: "Prime Intellect availability/gpus",
    checkoutSemantics: ["manual_provider"],
    checkoutUrlRules: [
      { semantics: "manual_provider", host: "app.primeintellect.ai", path: /^\/dashboard\/create\/?$/, requiredParams: ["cloudId", "gpuType", "gpuCount", "provider", "dataCenter"] }
    ],
    validate(item, fail) {
      const raw = item.rawPayload || {};
      requirePositive(fail, item, "prices.onDemand/pricePerHour", raw.prices?.onDemand || raw.pricePerHour);
      requireAvailableStock(fail, item, raw.stockStatus);
      requirePositive(fail, item, "gpuCount", raw.gpuCount);
    }
  },
  "lambda": {
    source: "Lambda instance-types regions_with_capacity_available",
    checkoutSemantics: ["manual_provider"],
    checkoutUrlRules: [
      { semantics: "manual_provider", host: "cloud.lambda.ai", path: /^\/instances\/?$/, requiredParams: ["instance_type", "region"] }
    ],
    validate(item, fail) {
      const raw = item.rawPayload || {};
      const regions = raw.regions_with_capacity_available || raw.available_regions || [];
      requireArrayWithRows(fail, item, "regions_with_capacity_available", regions);
      requirePositive(fail, item, "price_cents_per_hour", raw.price_cents_per_hour || raw.instance_type?.price_cents_per_hour);
    }
  },
  "cudo": {
    source: "CUDO VM machine-types and bare-metal machinesFree",
    checkoutSemantics: ["manual_provider"],
    checkoutUrlRules: [
      { semantics: "manual_provider", host: "www.cudocompute.com", path: /^\/console\/?$/, requiredParams: ["kind"] }
    ],
    validate(item, fail) {
      const raw = item.rawPayload || {};
      if (String(item.rawOfferId || "").startsWith("vm:")) {
        requirePositive(fail, item, "maxGpuFree/totalGpuFree", raw.maxGpuFree ?? raw.totalGpuFree);
      } else {
        requirePositive(fail, item, "machinesFree", raw.machinesFree);
      }
    }
  },
  "sesterce": {
    source: "Sesterce offers?available=true availability slots",
    checkoutSemantics: ["manual_provider"],
    checkoutUrlRules: [
      { semantics: "manual_provider", host: "cloud.sesterce.com", path: /^\/clusters\/?$/, requiredParams: ["instanceId", "region"] }
    ],
    validate(item, fail) {
      const raw = item.rawPayload || {};
      requirePositive(fail, item, "hourlyPrice", raw.hourlyPrice);
      if (item.metadata?.providerAvailability?.available !== true) fail(item, "provider availability slot is not true");
    }
  },
  "clore-ai": {
    source: "Clore marketplace/spot servers where rented=false",
    checkoutSemantics: ["exact_listing"],
    checkoutUrlRules: [
      { semantics: "exact_listing", host: "clore.ai", path: /^\/marketplace\/?$/, requiredParams: ["server"] }
    ],
    validate(item, fail) {
      const raw = item.rawPayload || {};
      if (raw.rented === true) fail(item, "raw rented=true");
      if (!raw.id) fail(item, "missing exact Clore server id");
      requirePositive(fail, item, "totalHourlyPrice", item.totalHourlyPrice);
    }
  },
  "hyperstack": {
    source: "Hyperstack core/flavors with stock_available=true",
    checkoutSemantics: ["manual_provider"],
    checkoutUrlRules: [
      { semantics: "manual_provider", host: "console.hyperstack.cloud", path: /^\/deploy-vm\/?$/, requiredParams: ["flavor", "region"] }
    ],
    validate(item, fail) {
      const raw = item.rawPayload || {};
      if (raw.stock_available !== true) fail(item, "stock_available is not true");
      requirePositive(fail, item, "gpu_count", raw.gpu_count || raw.gpuCount);
      requirePositive(fail, item, "price", item.totalHourlyPrice || item.pricePerGpuHour);
    }
  },
  "verda-datacrunch": {
    source: "Verda/DataCrunch instance-availability joined to instance-types",
    checkoutSemantics: ["manual_provider"],
    checkoutUrlRules: [
      { semantics: "manual_provider", host: "console.verda.com", path: /^\/dashboard\/projects\/[^/]+\/deploy-instance\/?$/, requiredParams: ["instance_type", "location_code", "market"] }
    ],
    validate(item, fail) {
      const raw = item.rawPayload || {};
      if (/catalog/i.test(item.rawOfferId || "")) fail(item, "catalog fallback row displayed");
      requirePositive(fail, item, "price_per_hour/spot_price", item.rawOfferId?.startsWith("spot:") ? raw.spot_price : raw.price_per_hour);
    }
  },
  "vultr": {
    source: "Vultr region availability for GPU plans",
    checkoutUrlRules: [
      { semantics: "prefilled_deploy", host: "my.vultr.com", path: /^\/deploy\/?$/, requiredParams: ["plan", "region", "type"] }
    ],
    validate(item, fail) {
      const raw = item.rawPayload || {};
      if (raw.deploy_ondemand === false && raw.deploy_preemptible === false) fail(item, "both on-demand and preemptible deploy disabled");
      if (/catalog/i.test(item.rawOfferId || "")) fail(item, "catalog fallback row displayed");
      requirePositive(fail, item, "hourly_cost", raw.hourly_cost);
    }
  },
  "scaleway": {
    source: "Scaleway products/servers availability",
    checkoutUrlRules: [
      { semantics: "prefilled_deploy", host: "console.scaleway.com", path: /^\/instance\/servers\/create\/?$/, requiredParams: ["commercial_type", "zone"] }
    ],
    validate(item, fail) {
      const raw = item.rawPayload || {};
      if (!/^(available|scarce)$/i.test(String(raw.availability?.availability || ""))) {
        fail(item, `availability is ${raw.availability?.availability || "missing"}`);
      }
      requirePositive(fail, item, "hourly_price", raw.hourly_price);
    }
  },
  "tensordock": {
    source: "TensorDock locations GPU max_count",
    checkoutSemantics: ["manual_provider"],
    checkoutUrlRules: [
      { semantics: "manual_provider", host: "dashboard.tensordock.com", path: /^\/deploy\/?$/, requiredParams: ["location_id", "gpu", "max_count"] }
    ],
    validate(item, fail) {
      const raw = item.rawPayload || {};
      requirePositive(fail, item, "gpu.max_count", raw.gpu?.max_count || raw.gpu?.availableCount);
      requirePositive(fail, item, "gpu.price_per_hr", raw.gpu?.price_per_hr);
    }
  },
  "gcore": {
    source: "Gcore GPU flavor include_capacity=true",
    checkoutSemantics: ["manual_provider"],
    checkoutUrlRules: [
      { semantics: "manual_provider", host: "cloud.gcore.com", path: /^\/cloud\/gpu\/?$/, requiredParams: ["project_id", "region_id", "flavor"] }
    ],
    validate(item, fail) {
      const raw = item.rawPayload || {};
      if (raw.disabled === true) fail(item, "raw disabled=true");
      requirePositive(fail, item, "capacity/available_capacity", raw.capacity ?? raw.available_capacity ?? raw.stock ?? raw.available);
      requirePositive(fail, item, "price_per_hour", item.totalHourlyPrice);
    }
  },
  "mithril": {
    mustNotDisplay: true,
    source: "Mithril spot/availability capacity joined to instance-types",
    checkoutSemantics: ["provider_console"],
    validate(item, fail) {
      const raw = item.rawPayload || {};
      requirePositive(fail, item, "auction.capacity", raw.auction?.capacity);
      requirePositive(fail, item, "auction.last_instance_price", moneyToNumber(raw.auction?.last_instance_price || raw.auction?.lowest_allocated_price));
      requirePositive(fail, item, "instanceType.num_gpus", raw.instanceType?.num_gpus || item.gpuCount);
      if (!raw.auction?.instance_type) fail(item, "missing spot auction instance_type");
      if (!raw.auction?.region) fail(item, "missing spot auction region");
    }
  },
  "digitalocean": {
    mustNotDisplay: true,
    source: "DigitalOcean Sizes API exposes GPU size specs/prices/regions, not live checkout capacity"
  },
  "nscale": {
    mustNotDisplay: true,
    source: "Nscale flavor/region APIs expose accessible shapes, not immediate checkout capacity"
  },
  "ovhcloud": {
    mustNotDisplay: true,
    source: "OVHcloud Public Cloud flavors expose catalog/region availability, not exact checkout capacity"
  },
  "massed-compute": {
    source: "Massed Compute gpu-inventory capacity_available",
    checkoutSemantics: ["manual_provider"],
    checkoutUrlRules: [
      { semantics: "manual_provider", host: "vm.massedcompute.com", path: /^\/deploy\/?$/, requiredParams: ["productName", "regionName"] }
    ],
    validate(item, fail) {
      const raw = item.rawPayload || {};
      requirePositive(fail, item, "capacity_available", raw.capacity_available ?? raw.capacityAvailable);
      requireArrayWithRows(fail, item, "regions_with_capacity_available", raw.regions_with_capacity_available || raw.regionsWithCapacityAvailable);
      requirePositive(fail, item, "price_cents_per_hour", raw.instance_type?.price_cents_per_hour || raw.instanceType?.priceCentsPerHour);
    }
  },
  "e2e-cloud": {
    source: "E2E MyAccount images plan catalog filtered by GPU card details and available_inventory_status",
    checkoutSemantics: ["manual_provider"],
    checkoutUrlRules: [
      { semantics: "manual_provider", host: "myaccount.e2enetworks.com", path: /^\/?$/, requiredParams: ["plan", "image", "location"] }
    ],
    validate(item, fail) {
      const raw = item.rawPayload || {};
      if (raw.available_inventory_status !== true) fail(item, "available_inventory_status is not true");
      requirePositive(fail, item, "gpu_count", raw.gpu_card_details?.UNIT_COUNT || item.gpuCount);
      requirePositive(fail, item, "specs.price_per_hour", raw.specs?.price_per_hour);
      if (!item.gpuModel || item.gpuModel === "Unknown") fail(item, "missing normalized GPU model");
      if (!raw.plan) fail(item, "missing plan");
      if (!raw.image) fail(item, "missing image");
    }
  },
  "digitalocean": {
    source: "DigitalOcean /v2/sizes GPU droplets (available=true, price_hourly > 0)",
    checkoutSemantics: ["manual_provider"],
    checkoutUrlRules: [
      { semantics: "manual_provider", host: "cloud.digitalocean.com", path: /^\/droplets\/new\/?$/, requiredParams: ["size"] }
    ],
    validate(item, fail) {
      const raw = item.rawPayload || {};
      if (raw.available !== true) fail(item, "raw size available is not true");
      requirePositive(fail, item, "price_hourly", raw.price_hourly);
      if (!raw.gpu_info || !raw.gpu_info.count) fail(item, "missing gpu_info");
      if (!item.gpuModel || item.gpuModel === "Unknown") fail(item, "missing normalized GPU model");
    }
  },
  "mithril": {
    source: "Mithril /v2/pricing/current reserved_price_cents with available_capacity from instance-types",
    checkoutSemantics: ["manual_provider"],
    checkoutUrlRules: [
      { semantics: "manual_provider", host: "app.mithril.ai" }
    ],
    validate(item, fail) {
      // Mithril's reserved/auction clearing price is volatile (it varies hour to
      // hour), so a Mithril row must never be orderable. validate() only runs for
      // orderable items, so reaching here at all means the volatile-pricing guard
      // regressed — fail loudly.
      fail(item, "Mithril auction/reserved pricing is volatile and must not be displayed as orderable");
    }
  },
  "ovhcloud": {
    source: "OVHcloud Public Cloud flavors (available=true) priced from public catalog .consumption addon",
    checkoutSemantics: ["manual_provider"],
    checkoutUrlRules: [
      { semantics: "manual_provider", host: "us.ovhcloud.com", path: /^\/manager\/?$/ }
    ],
    validate(item, fail) {
      const raw = item.rawPayload || {};
      if (raw.available !== true) fail(item, "raw flavor available is not true");
      requirePositive(fail, item, "totalHourlyPrice", item.totalHourlyPrice);
      if (!item.gpuModel || item.gpuModel === "Unknown") fail(item, "missing normalized GPU model");
      if (item.metadata?.monthlyDerived === true) fail(item, "monthly-derived price displayed as orderable hourly");
    }
  },
  "gmi": {
    source: "GMI products valid flag",
    checkoutSemantics: ["manual_provider"],
    checkoutUrlRules: [
      { semantics: "manual_provider", host: "console.gmicloud.ai", path: /^\/create\/?$/, requiredParams: ["product", "idc"] }
    ],
    validate(item, fail) {
      const raw = item.rawPayload || {};
      if (raw.valid !== true) fail(item, "raw valid is not true");
      requirePositive(fail, item, "price", raw.price);
    }
  },
  "latitude": {
    source: "Latitude plan regions locations.in_stock",
    checkoutSemantics: ["manual_provider"],
    checkoutUrlRules: [
      { semantics: "manual_provider", host: "metal.new", path: /^\/?$/, requiredParams: ["plan", "location"] },
      { semantics: "manual_provider", host: "app.latitude.sh", path: /^\/deploy\/?$/, requiredParams: ["plan", "location"] }
    ],
    validate(item, fail) {
      const raw = item.rawPayload || {};
      const inStock = raw.region?.locations?.in_stock || [];
      const available = raw.region?.locations?.available || raw.region?.deploys_instantly || [];
      if (![...inStock, ...available].includes(raw.location)) fail(item, "raw location is not listed as in-stock/available");
      requirePositive(fail, item, "pricing", item.totalHourlyPrice);
    }
  },
  "aws": {
    mustNotDisplay: true,
    source: "AWS offered-location and pricing catalog, not live checkout capacity"
  },
  "azure": {
    mustNotDisplay: true,
    source: "Azure Resource SKUs and Retail Prices, not live checkout capacity"
  },
  "oci": {
    mustNotDisplay: true,
    source: "OCI shapes/ratecard, not live checkout capacity"
  },
  "nebius": {
    mustNotDisplay: true,
    source: "Nebius compute platform catalog, not live checkout capacity"
  },
  "google-cloud": {
    mustNotDisplay: true,
    source: "Google Cloud billing catalog, not live checkout capacity"
  },
  "google-tpu": {
    mustNotDisplay: true,
    source: "Google Cloud TPU billing catalog (per-chip-hour on-demand SKUs), not live checkout capacity"
  },
  "together-ai": {
    mustNotDisplay: true,
    source: "Together supported cluster catalog, not priced live checkout capacity"
  },
  "crusoe": {
    mustNotDisplay: true,
    source: "Crusoe capacity is unpriced in current adapter"
  },
  "voltage-park": {
    mustNotDisplay: true,
    source: "Voltage hostnode API does not map to public checkout inventory"
  },
  "akamai-linode": {
    mustNotDisplay: true,
    source: "Akamai/Linode instance-type catalog with region price overrides, a region offering rather than live checkout capacity"
  },
  "civo": {
    mustNotDisplay: true,
    source: "Civo /v2/sizes GPU catalog gated by region features.gpu; API exposes no price, so rows are an unpriced region offering"
  },
  "novita": {
    mustNotDisplay: true,
    source: "Novita gpu-instance products expose real on-demand price + inventoryState, but the deploy console deep-link prefill is unverified, so rows are a priced catalog (provider_console), not claimed checkout"
  },
  "oblivus": {
    mustNotDisplay: true,
    source: "Oblivus metadata+stock expose per-GPU price and per-location deployable counts, but the deploy console deep-link prefill is unverified, so rows are a priced catalog (provider_console), not claimed checkout"
  },
  "leader-gpu": {
    mustNotDisplay: true,
    source: "LeaderGPU products expose per-server EUR price + availability, but ordering creates a proforma invoice (payment) rather than a deep-link checkout, so rows are a priced catalog (provider_console)"
  },
  "thunder-compute": {
    mustNotDisplay: true,
    source: "Thunder Compute public pricing+specs APIs expose SKU prices/specs but no live capacity, so rows are a priced catalog (provider_console), not orderable"
  },
  "outscale": {
    mustNotDisplay: true,
    source: "Outscale ReadPublicCatalog exposes per-GPU Flexible GPU prices per region but no live capacity, so rows are a region offering (provider_console), not orderable"
  },
  "leafcloud": {
    mustNotDisplay: true,
    source: "leafcloud per-GPU EUR prices scraped from its pricing page (no pricing API; OpenStack capacity needs project creds), so rows are a region offering (provider_console), not orderable"
  },
  "seeweb": {
    mustNotDisplay: true,
    source: "Seeweb per-GPU EUR prices scraped from its product page (no pricing API; OpenStack capacity needs project creds), so rows are a region offering (provider_console), not orderable"
  },
  "saladcloud": {
    mustNotDisplay: true,
    source: "SaladCloud gpu-classes expose priority-tier prices for distributed/interruptible community GPUs with no live capacity, so rows are a priced catalog (provider_console), not orderable"
  },
  "jarvis-labs": {
    mustNotDisplay: true,
    source: "Jarvis Labs server_meta exposes per-GPU INR price + free-device counts per region, but the deploy console deep-link prefill is unverified, so rows are a priced catalog (provider_console), not claimed checkout"
  },
  "hydra-host": {
    mustNotDisplay: true,
    source: "Hydra Host Brokkr public marketplace exposes per-category starting (from) prices + availability counts but no exact checkout, so rows are a priced catalog (provider_console), not orderable"
  },
  "sakura": {
    mustNotDisplay: true,
    source: "SAKURA public IaaS price-list API exposes 高火力 VRT plan JPY prices per Ishikari zone but no live capacity, so rows are a region-offering price catalog (provider_console), not orderable"
  },
  "ionos": {
    mustNotDisplay: true,
    source: "IONOS public price calculator exposes fixed H200 GPU VM plan prices but no live capacity (provisioning is account/token-gated), so rows are a region-offering price catalog (provider_console), not orderable"
  },
  "exabits": {
    mustNotDisplay: true,
    source: "Exabits flavors API exposes per-GPU hourly price + a stock_available boolean (not a bookable count) per region, so rows are a region-offering price catalog (provider_console), not orderable"
  },
  "sharon-ai": {
    mustNotDisplay: true,
    source: "Sharon AI compute-profile catalog (Rafay PaaS API) exposes per-instance hourly AUD prices for its GPU SKUs but no live capacity, so rows are a region-offering price catalog (provider_console), not orderable"
  },
  "atlantic-net": {
    mustNotDisplay: true,
    source: "Atlantic.Net GPU cloud page exposes per-plan on-demand hourly USD prices via schema.org JSON-LD but no live capacity (provisioning is account/signature-API-gated), so rows are a region-offering price catalog (provider_console), not orderable"
  },
  "gpulist-ai": {
    mustNotDisplay: true,
    source: "gpulist.ai is a community GPU listings board (brokerage): verified third-party reservation offers with a per-GPU hourly price but minimum-GPU/minimum-week bookings and contact-the-seller flow, so rows are a region-offering price catalog (provider_console), not orderable"
  },
  "denvr": {
    mustNotDisplay: true,
    source: "Denvr VM configuration availability API exposes priced creatable counts per cluster/resource pool, but CreateServer is mutating and no exact deploy link is verified, so rows are a priced capacity catalog (provider_console), not orderable"
  },
  "contabo": {
    mustNotDisplay: true,
    source: "Contabo GPU Cloud public product page exposes monthly EUR GPU plan prices/specs, but no live capacity or exact checkout proof; rows are a converted hourly price catalog (provider_console), not orderable"
  },
  "hetzner": {
    mustNotDisplay: true,
    source: "Hetzner public Robot available_configurations endpoint exposes live GEX dedicated GPU server quantities and prices, but the public configurator is product-level rather than an exact listing/order URL, so rows are capacity catalog entries (provider_console), not orderable"
  },
  "utho": {
    mustNotDisplay: true,
    source: "Utho public GPU page bundle exposes monthly INR GPU plan prices/specs, but no live stock/capacity endpoint or exact deploy listing URL was found, so rows are price catalog entries (provider_console), not orderable"
  },
  "greennode": {
    mustNotDisplay: true,
    source: "GreenNode public pricing page CMS state/table exposes H100 on-demand USD prices/specs, but the documented vServer flavor APIs require auth/project context and no public stock/capacity endpoint or exact deploy listing URL was found, so rows are price catalog entries (provider_console), not orderable"
  },
  "acecloud": {
    mustNotDisplay: true,
    source: "ACE Cloud official pricing pages expose GPU SKU prices/specs, but the OpenStack APIs require account/project credentials and no public stock/capacity endpoint or exact deploy listing URL was found, so rows are price catalog entries (provider_console), not orderable"
  },
  "arkane-cloud": {
    mustNotDisplay: true,
    source: "Arkane Cloud official pricing page exposes per-GPU on-demand prices/specs, and the documented compute APIs are authenticated deploy/list/manage endpoints with no public read-only catalog/capacity endpoint found, so rows are price catalog entries (provider_console), not orderable"
  },
  "hot-aisle": {
    mustNotDisplay: true,
    source: "Hot Aisle public team API (virtual_machines/available + bare_metal/available) exposes whole-instance hourly USD prices and a creatable/reservable Quantity per MI300X type, but the only provisioning route is the mutating create endpoint with no exact deploy listing URL, so rows are a priced capacity catalog (provider_console), not orderable"
  },
  "hpc-ai": {
    mustNotDisplay: true,
    source: "HPC-AI.com publishes a single on-demand per-GPU/hr USD price in each public /gpus/<model> page, but there is no public pricing API (the documented REST API is JWT-login-gated and exposes only instance create/list/stop) and no live stock/capacity or exact deploy listing route, so rows are a price catalog (provider_console), not orderable"
  },
  "northflank": {
    mustNotDisplay: true,
    source: "Northflank publishes all-inclusive managed per-GPU/hr USD prices as cards on its public pricing page (the public API exposes only CPU compute plans and an unpriced hardware catalog), but it is a deploy PaaS with no live stock/capacity or exact deploy listing route, so rows are a price catalog (provider_console), not orderable"
  },
  "hivenet": {
    mustNotDisplay: true,
    source: "Hivenet public presets/pricing API exposes per-preset hourly EUR prices + specs + location for RTX 4090/5090, but no live capacity signal or exact deploy listing route, so rows are a region-offering price catalog (provider_console), not orderable"
  },
  "ionstream": {
    mustNotDisplay: true,
    source: "ionstream.ai homepage publishes per-GPU 'Pricing starts at $X p/hr' starting/from floors (L40S/H200/B200) in solution cards, but it is a marketing site with no public catalog/pricing API and no live stock or exact deploy listing route, so rows are a lowest-SKU price catalog (provider_console), not orderable"
  },
  "ionet": {
    mustNotDisplay: true,
    source: "io.net IO Cloud public hardware API (vmaas/caas) exposes whole-config hourly USD prices, specs, location and a deployable available_replicas count, but it is a decentralized network whose provisioning needs the IO console + a funded wallet with no exact orderable checkout listing, so rows are a priced capacity catalog (provider_console), not orderable"
  },
  "coreweave": {
    mustNotDisplay: true,
    source: "CoreWeave publishes per-instance On-Demand hourly USD prices (with GPU Count + VRAM) as cards on its public pricing page, but there is no public instance-type/pricing API and no live stock or exact deploy listing route (enterprise onboarding), so rows are a price catalog (provider_console), not orderable"
  },
  "liquidweb": {
    mustNotDisplay: true,
    source: "LiquidWeb publishes per-config discounted hourly USD prices (model + VRAM + optional GPU count) as cards on its public GPU hosting page, but there is no public pricing API and no live stock or exact deploy listing route, so rows are a price catalog (provider_console), not orderable"
  },
  "qubrid": {
    mustNotDisplay: true,
    source: "Qubrid publishes its on-demand GPU catalog (per-config hourly USD price + specs + availability flag) as embedded JS on its public pricing page, but there is no public pricing API and no live stock or exact deploy listing route, so rows are a price catalog (provider_console), not orderable"
  },
  "core42": {
    mustNotDisplay: true,
    source: "Core42 publishes per-GPU 'From $X/hr' starting floors (H100/H200/B200/MI300X) as cards on its public AI Cloud product page, but pay-as-you-go is console-signup only with no public pricing API and no live stock or exact deploy listing route, so rows are a lowest-SKU price catalog (provider_console), not orderable"
  },
  "flexai": {
    mustNotDisplay: true,
    source: "FlexAI publishes per-GPU on-demand hourly USD prices as schema.org Offer objects on its public pricing page, but it is a cross-cloud orchestration layer with no live stock or exact deploy listing route, so rows are a price catalog (provider_console), not orderable"
  },
  "valdi": {
    mustNotDisplay: true,
    source: "Valdi publishes per-GPU 'Starting at $X/hr' floors as cards on its public home page, but there is no public provisioning/pricing API and no live stock or exact deploy listing route, so rows are a lowest-SKU price catalog (provider_console), not orderable"
  },
  "farmgpu": {
    mustNotDisplay: true,
    source: "FarmGPU publishes per-GPU hourly USD prices for its H100/B200 bare-metal clusters on its public pricing page, but there is no public provisioning/pricing API and no live stock or exact deploy listing route, so rows are a price catalog (provider_console), not orderable"
  },
  "cirrascale": {
    mustNotDisplay: true,
    source: "Cirrascale publishes per-GPU/hr term-equivalent rates for its reserved GPU instances as accordion plans on its public pricing page, but it is a reserved-commitment offering with no public provisioning/pricing API and no live stock or exact deploy listing route, so rows are a price catalog (provider_console), not orderable"
  },
  "whitefiber": {
    mustNotDisplay: true,
    source: "WhiteFiber publishes per-GPU 'Starting at $X/HR' floors (B200/GB200/B300/GB300) as cards on its public pricing page, but there is no public provisioning/pricing API and no live stock or exact deploy listing route, so rows are a lowest-SKU price catalog (provider_console), not orderable"
  },
  "yottalabs": {
    mustNotDisplay: true,
    source: "Yotta Labs publishes per-GPU on-demand hourly USD prices in its public pricing table, but there is no public provisioning/pricing API and no live stock or exact deploy listing route, so rows are a price catalog (provider_console), not orderable"
  },
  "neysa": {
    mustNotDisplay: true,
    source: "Neysa publishes per-GPU 'Starts at $X / hour' floors (L4/L40S/H100/H200) as cards on its public pricing page, but there is no public provisioning/pricing API and no live stock or exact deploy listing route, so rows are a lowest-SKU price catalog (provider_console), not orderable"
  },
  "taiga": {
    mustNotDisplay: true,
    source: "Northern Data / Taiga Cloud publishes per-GPU 'from $X' hourly USD rates (H100/H200 SXM, bare-metal and on-demand) in its public pricing tables, but there is no public provisioning/pricing API and no live stock or exact deploy listing route, so rows are a price catalog (provider_console), not orderable"
  },
  "olakrutrim": {
    mustNotDisplay: true,
    source: "Ola Krutrim publishes per-instance on-demand INR/hr GPU prices (A100/H100) in its public pricing tables (converted to USD via FX), but there is no public provisioning/pricing API and no live stock or exact deploy listing route, so rows are a price catalog (provider_console), not orderable"
  },
  "zoner": {
    mustNotDisplay: true,
    source: "Zoner publishes per-GPU hourly USD rates (RTX 4090/5090/PRO 6000/H200) in the embedded price table of its public GPU-server configurator, but there is no public provisioning/pricing API and no live stock or exact deploy listing route, so rows are a price catalog (provider_console), not orderable"
  },
  "neevcloud": {
    mustNotDisplay: true,
    source: "NeevCloud's Inventory API (api.ai.neevcloud.com, Bearer pat-nc-* / login JWT) returns per-GPU hourly USD prices and live available_gpu_count, but provisioning is an API mutation with no prefilled deploy URL, so rows are a priced capacity catalog (provider_console), not orderable"
  },
  "getdeploying": {
    mustNotDisplay: true,
    source: "getDeploying is a GPU price-comparison aggregator/meta-source: its reference pages expose per-provider on-demand $/GPU/hr (spot/reserved dropped) but no live capacity, and the rows overlap with direct integrations, so they are a non-orderable cross-check catalog (provider_console)"
  },
  "nebulablock": {
    mustNotDisplay: true,
    source: "Nebula Block's public products API returns whole-instance hourly USD (per-GPU = price/gpu_count) with live stock/is_available (spot rows dropped), but provisioning needs the console + funded wallet with no exact deploy URL, so rows are a priced capacity catalog (provider_console), not orderable"
  },
  "trainy": {
    mustNotDisplay: true,
    source: "Trainy publishes one on-demand 8xH100 per-GPU/hr rate on its public pricing page (reserved is contact-sales), with no public provisioning/pricing API or live stock, so rows are a price catalog (provider_console), not orderable"
  },
  "turboscale": {
    mustNotDisplay: true,
    source: "Turboscale publishes whole-config hourly USD GPU prices (H100/A100/V100) in its public pricing table (per-GPU = price/count), but has no public provisioning/pricing API or live stock, so rows are a price catalog (provider_console), not orderable"
  },
  "visionbay": {
    mustNotDisplay: true,
    source: "Visionbay publishes per-GPU hourly USD rates (H100/B300/GB200/GB300) on its public pricing page, but has no public provisioning/pricing API or live stock, so rows are a price catalog (provider_console), not orderable"
  },
  "cloudclusters": {
    mustNotDisplay: true,
    source: "CloudClusters publishes monthly USD GPU server prices and specs on its public GPU server page (normalized to hourly at price/730), but has no public stock API or exact deploy listing route, so rows are a price catalog (provider_console), not orderable"
  },
  "airon": {
    mustNotDisplay: true,
    source: "Airon publishes per-GPU hourly USD starting prices in public structured data and documentation, but has no public stock or exact deploy listing route, so rows are a price catalog (provider_console), not orderable"
  },
  "ax3": {
    mustNotDisplay: true,
    source: "Ax3 publishes per-GPU starting hourly USD rates and regional capacity context on its public pricing page, but has no public stock API or exact deploy listing route, so rows are a price catalog (provider_console), not orderable"
  },
  "cato-digital": {
    mustNotDisplay: true,
    source: "Cato Digital publishes whole-node hourly USD prices for V100 GPU servers on its public product page, but has no public stock API or exact deploy listing route, so rows are a price catalog (provider_console), not orderable"
  },
  "cloudexe": {
    mustNotDisplay: true,
    source: "Cloudexe publishes H100 per-GPU hourly prices by tier on its public home page (spot tier dropped), but has no public stock API or exact deploy listing route, so rows are a price catalog (provider_console), not orderable"
  },
  "highreso": {
    mustNotDisplay: true,
    source: "HIGHRESO / GPUSOROBAN publishes yen-denominated GPU cloud prices on public pages (minute/month rates normalized to hourly), but has no public stock API or exact deploy listing route, so rows are a price catalog (provider_console), not orderable"
  },
  "nodeai": {
    mustNotDisplay: true,
    source: "NodeAI publishes per-GPU hourly USD prices and supply counts in public Next.js pricing JSON, but deployment requires the app and no exact listing URL is exposed, so rows are a priced capacity catalog (provider_console), not orderable"
  },
  "charg": {
    mustNotDisplay: true,
    source: "Charg publishes whole-node hourly USD pricing for an 8x V100 node on its public pricing page, but has no public stock API or exact deploy listing route, so rows are a price catalog (provider_console), not orderable"
  },
  "polaris": {
    mustNotDisplay: true,
    source: "Polaris publishes a public pricing API with on-demand GPU rates; renting requires signed-in actions and spot prices are not used for inventory rows, so rows are a non-orderable price catalog (provider_console)"
  },
  "slyd": {
    mustNotDisplay: true,
    source: "SLYD publishes public server-rendered marketplace cards with hourly USD GPU rates and available-now status, but deploy links are login-backed generic marketplace filters, so rows are not checkout-proof exact listings"
  }
};

export function providerHasCheckoutTruthContract(providerId) {
  return Boolean(CHECKOUT_TRUTH_CONTRACTS[providerId]);
}

export function validateCheckoutTruthItem(item) {
  const failures = [];
  const warnings = [];
  const contract = CHECKOUT_TRUTH_CONTRACTS[item.providerId];
  const fail = (target, message) => failures.push(`${target.providerId}:${target.rawOfferId}: ${message}`);
  const warn = (target, message) => warnings.push(`${target.providerId}:${target.rawOfferId}: ${message}`);

  if (!contract) {
    fail(item, "missing checkout truth contract");
    return { failures, warnings };
  }

  // Non-orderable rows carry no checkout claim to validate; snapshot-level checks
  // still enforce that mustNotDisplay providers expose zero orderable rows.
  if (!item.orderable) return { failures, warnings };

  if (contract.mustNotDisplay) fail(item, `${contract.source} must not be displayed as orderable`);
  if (item.sourceMode !== "live") fail(item, `sourceMode is ${item.sourceMode}, expected live`);
  if (item.availability !== "available") fail(item, `availability is ${item.availability}, expected available`);
  if (!["host_capacity", "sku_capacity"].includes(item.availabilitySemantics)) {
    fail(item, `availabilitySemantics is ${item.availabilitySemantics}, expected host_capacity or sku_capacity`);
  }
  if (["unpriced", "unknown"].includes(item.priceSemantics) || (!positive(item.totalHourlyPrice) && !positive(item.pricePerGpuHour))) {
    fail(item, `priceSemantics is ${item.priceSemantics}, missing checkout price`);
  }
  const allowedCheckoutSemantics = contract.checkoutSemantics || ["exact_listing", "prefilled_deploy"];
  if (!allowedCheckoutSemantics.includes(item.checkoutSemantics)) {
    fail(item, `checkoutSemantics is ${item.checkoutSemantics}, expected ${allowedCheckoutSemantics.join(" or ")}`);
  }
  if (!item.checkoutUrl) fail(item, "missing checkoutUrl");
  validateCheckoutUrlRules(item, contract, fail);
  if (!item.rawPayload) fail(item, "missing rawPayload");
  if (item.rawPayload?.fixture) fail(item, "fixture payload displayed as orderable");

  if (contract.validate) contract.validate(item, fail, warn);
  return { failures, warnings };
}

export function validateCheckoutTruthSnapshot(items, providerHealth = []) {
  const failures = [];
  const warnings = [];
  for (const item of items) {
    const result = validateCheckoutTruthItem(item);
    failures.push(...result.failures);
    warnings.push(...result.warnings);
  }

  for (const provider of providerHealth) {
    const contract = CHECKOUT_TRUTH_CONTRACTS[provider.id];
    if (!contract) continue;
    if (contract.mustNotDisplay && Number(provider.itemCount || 0) > 0) {
      failures.push(`${provider.id}: provider must not display orderable rows (${contract.source})`);
    }
  }

  return { failures, warnings };
}

function requirePositive(fail, item, label, value) {
  if (!positive(value)) fail(item, `${label} is not positive`);
}

function moneyToNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function requireArrayWithRows(fail, item, label, value) {
  if (!Array.isArray(value) || !value.length) fail(item, `${label} is empty`);
}

function requireAvailableStock(fail, item, value) {
  const text = String(value || "").trim();
  if (!text || /out|none|unavailable|sold|false|0/i.test(text)) fail(item, `stock is ${text || "missing"}`);
}

function validateCheckoutUrlRules(item, contract, fail) {
  if (!item.checkoutUrl) return;
  const rules = contract.checkoutUrlRules || [];
  if (!rules.length) {
    for (const param of contract.requiredCheckoutParams || []) {
      if (!urlParam(item.checkoutUrl, param)) fail(item, `checkoutUrl missing ${param}`);
    }
    return;
  }

  const parsed = parseUrl(item.checkoutUrl);
  if (!parsed) {
    fail(item, `checkoutUrl is not a valid URL: ${item.checkoutUrl}`);
    return;
  }

  const matchingRule = rules.find((rule) => checkoutUrlRuleMatches(rule, item, parsed));
  if (!matchingRule) {
    fail(item, `checkoutUrl ${parsed.hostname}${parsed.pathname} is not an approved ${item.checkoutSemantics} route`);
    return;
  }

  for (const param of matchingRule.requiredParams || []) {
    if (!parsed.searchParams.has(param)) fail(item, `checkoutUrl missing ${param}`);
  }
}

function checkoutUrlRuleMatches(rule, item, parsed) {
  const semantics = Array.isArray(rule.semantics) ? rule.semantics : [rule.semantics];
  if (semantics.filter(Boolean).length && !semantics.includes(item.checkoutSemantics)) return false;
  if (rule.host) {
    const hosts = Array.isArray(rule.host) ? rule.host : [rule.host];
    if (!hosts.some((host) => hostMatches(host, parsed.hostname))) return false;
  }
  if (rule.path) {
    const path = parsed.pathname || "/";
    if (rule.path instanceof RegExp) return rule.path.test(path);
    return String(rule.path) === path;
  }
  return true;
}

function hostMatches(expected, actual) {
  if (expected instanceof RegExp) return expected.test(actual);
  return String(expected || "").toLowerCase() === String(actual || "").toLowerCase();
}

function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function positive(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

function urlParam(value, param) {
  try {
    return new URL(value).searchParams.has(param);
  } catch {
    return false;
  }
}
