import { awsInventoryRowToInventoryItem, crawl as crawlAwsInventory, hasAwsConfiguration } from "../providers/aws.js";
import { azureInventoryRowToInventoryItem, crawl as crawlAzureInventory, crawlPublicRetail as crawlAzurePublicRetail, hasAzureConfiguration } from "../providers/azure.js";
import { crawl as crawlDigitalOceanInventory, hasDigitalOceanConfiguration } from "../providers/digitalocean.js";
import { crawl as crawlLatitudeInventory, hasLatitudeConfiguration } from "../providers/latitude.js";
import { crawl as crawlMithrilInventory, hasMithrilConfiguration } from "../providers/mithril.js";
import { crawl as crawlNebiusInventory, hasNebiusConfiguration, nebiusInventoryRowToInventoryItem } from "../providers/nebius.js";
import { crawl as crawlNscaleInventory, hasNscaleConfiguration } from "../providers/nscale.js";
import { ociInventoryRowToInventoryItem, crawl as crawlOciInventory, hasOciConfiguration } from "../providers/oci.js";
import { crawl as crawlOvhCloudInventory, hasOvhCloudConfiguration } from "../providers/ovhcloud.js";

import { shadeformConnector } from "./live/providers/shadeform.js";
import { primeConnector } from "./live/providers/prime.js";
import { vastConnector } from "./live/providers/vast.js";
import { cloreConnector } from "./live/providers/clore.js";
import { lambdaConnector } from "./live/providers/lambda.js";
import { crusoeConnector } from "./live/providers/crusoe.js";
import { cudoConnector } from "./live/providers/cudo.js";
import { sesterceConnector } from "./live/providers/sesterce.js";
import { runpodConnector } from "./live/providers/runpod.js";
import { googleCloudConnector } from "./live/providers/google-cloud.js";
import { googleTpuConnector } from "./live/providers/google-tpu.js";
import { voltageParkConnector } from "./live/providers/voltage-park.js";
import { verdaConnector } from "./live/providers/verda.js";
import { vultrConnector } from "./live/providers/vultr.js";
import { scalewayConnector } from "./live/providers/scaleway.js";
import { tensordockConnector } from "./live/providers/tensordock.js";
import { gmiConnector } from "./live/providers/gmi.js";
import { hyperstackConnector } from "./live/providers/hyperstack.js";
import { gcoreConnector } from "./live/providers/gcore.js";
import { massedComputeConnector } from "./live/providers/massed-compute.js";
import { e2eConnector } from "./live/providers/e2e.js";
import { togetherConnector } from "./live/providers/together.js";
import { linodeConnector } from "./live/providers/linode.js";
import { civoConnector } from "./live/providers/civo.js";
import { novitaConnector } from "./live/providers/novita.js";
import { oblivusConnector } from "./live/providers/oblivus.js";
import { leadergpuConnector } from "./live/providers/leadergpu.js";
import { thundercomputeConnector } from "./live/providers/thundercompute.js";
import { outscaleConnector } from "./live/providers/outscale.js";
import { leafcloudConnector } from "./live/providers/leafcloud.js";
import { seewebConnector } from "./live/providers/seeweb.js";
import { saladcloudConnector } from "./live/providers/saladcloud.js";
import { jarvislabsConnector } from "./live/providers/jarvislabs.js";
import { hydrahostConnector } from "./live/providers/hydrahost.js";
import { sakuraConnector } from "./live/providers/sakura.js";
import { ionosConnector } from "./live/providers/ionos.js";
import { exabitsConnector } from "./live/providers/exabits.js";
import { sharonaiConnector } from "./live/providers/sharonai.js";
import { atlanticnetConnector } from "./live/providers/atlanticnet.js";
import { gpulistConnector } from "./live/providers/gpulist.js";
import { denvrConnector } from "./live/providers/denvr.js";
import { contaboConnector } from "./live/providers/contabo.js";
import { hetznerConnector } from "./live/providers/hetzner.js";
import { uthoConnector } from "./live/providers/utho.js";
import { greennodeConnector } from "./live/providers/greennode.js";
import { acecloudConnector } from "./live/providers/acecloud.js";
import { arkaneConnector } from "./live/providers/arkane.js";
import { hotaisleConnector } from "./live/providers/hotaisle.js";
import { hpcaiConnector } from "./live/providers/hpcai.js";
import { northflankConnector } from "./live/providers/northflank.js";
import { hivenetConnector } from "./live/providers/hivenet.js";
import { ionstreamConnector } from "./live/providers/ionstream.js";
import { ionetConnector } from "./live/providers/ionet.js";
import { coreweaveConnector } from "./live/providers/coreweave.js";
import { liquidwebConnector } from "./live/providers/liquidweb.js";
import { qubridConnector } from "./live/providers/qubrid.js";
import { core42Connector } from "./live/providers/core42.js";
import { flexaiConnector } from "./live/providers/flexai.js";
import { valdiConnector } from "./live/providers/valdi.js";
import { farmgpuConnector } from "./live/providers/farmgpu.js";
import { cirrascaleConnector } from "./live/providers/cirrascale.js";
import { whitefiberConnector } from "./live/providers/whitefiber.js";
import { yottalabsConnector } from "./live/providers/yottalabs.js";
import { neysaConnector } from "./live/providers/neysa.js";
import { taigaConnector } from "./live/providers/taiga.js";
import { olakrutrimConnector } from "./live/providers/olakrutrim.js";
import { zonerConnector } from "./live/providers/zoner.js";
import { neevcloudConnector } from "./live/providers/neevcloud.js";
import { getdeployingConnector } from "./live/providers/getdeploying.js";
import { nebulablockConnector } from "./live/providers/nebulablock.js";
import { trainyConnector } from "./live/providers/trainy.js";
import { turboscaleConnector } from "./live/providers/turboscale.js";
import { visionbayConnector } from "./live/providers/visionbay.js";
import { cloudclustersConnector } from "./live/providers/cloudclusters.js";
import { aironConnector } from "./live/providers/airon.js";
import { ax3Connector } from "./live/providers/ax3.js";
import { catoConnector } from "./live/providers/cato.js";
import { cloudexeConnector } from "./live/providers/cloudexe.js";
import { highresoConnector } from "./live/providers/highreso.js";
import { nodeaiConnector } from "./live/providers/nodeai.js";
import { chargConnector } from "./live/providers/charg.js";
import { polarisConnector } from "./live/providers/polaris.js";
import { slydConnector } from "./live/providers/slyd.js";

export const liveConnectors = [
  shadeformConnector,
  primeConnector,
  vastConnector,
  cloreConnector,
  lambdaConnector,
  crusoeConnector,
  cudoConnector,
  sesterceConnector,
  runpodConnector,
  googleCloudConnector,
  googleTpuConnector,
  {
    id: "aws",
    name: "AWS",
    envVars: [
      "AWS_GPU_INVENTORY_ENABLED",
      "AWS_ACCESS_KEY_ID",
      "AWS_PROFILE",
      "AWS_WEB_IDENTITY_TOKEN_FILE",
      "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
      "AWS_CONTAINER_CREDENTIALS_FULL_URI"
    ],
    async fetch(env) {
      if (!hasAwsConfiguration(env)) return [];
      const rows = await crawlAwsInventory(env);
      return rows.map((row) => awsInventoryRowToInventoryItem(row, env));
    }
  },
  {
    id: "azure",
    name: "Azure",
    runsWithoutCredentials: true,
    envVars: [
      "AZURE_GPU_INVENTORY_ENABLED",
      "AZURE_SUBSCRIPTION_ID",
      "AZURE_ACCESS_TOKEN",
      "AZURE_CLIENT_ID",
      "AZURE_CLIENT_SECRET",
      "AZURE_TENANT_ID",
      "AZURE_FEDERATED_TOKEN_FILE"
    ],
    async fetch(env) {
      const rows = hasAzureConfiguration(env)
        ? await crawlAzureInventory(env)
        : await crawlAzurePublicRetail(env);
      return rows.map((row) => azureInventoryRowToInventoryItem(row, env));
    }
  },
  {
    id: "oci",
    name: "Oracle OCI",
    envVars: [
      "OCI_GPU_INVENTORY_ENABLED",
      "OCI_CONFIG_FILE",
      "OCI_PROFILE",
      "OCI_TENANCY_OCID",
      "OCI_USER_OCID",
      "OCI_FINGERPRINT",
      "OCI_PRIVATE_KEY",
      "OCI_PRIVATE_KEY_FILE",
      "OCI_RESOURCE_PRINCIPAL_VERSION"
    ],
    async fetch(env) {
      if (!hasOciConfiguration(env)) return [];
      const rows = await crawlOciInventory(env);
      return rows.map((row) => ociInventoryRowToInventoryItem(row, env));
    }
  },
  {
    id: "nebius",
    name: "Nebius",
    envVars: [
      "NEBIUS_ENABLED",
      "NEBIUS_TENANT_ID",
      "NEBIUS_PROJECT_ID",
      "NEBIUS_PROJECT_IDS",
      "NEBIUS_PROFILE"
    ],
    async fetch(env) {
      if (!hasNebiusConfiguration(env)) return [];
      const rows = await crawlNebiusInventory(env);
      return rows.map((row) => nebiusInventoryRowToInventoryItem(row, env));
    }
  },
  voltageParkConnector,
  verdaConnector,
  vultrConnector,
  scalewayConnector,
  tensordockConnector,
  {
    id: "latitude",
    name: "Latitude.sh",
    envVars: ["LATITUDE_API_KEY", "LATITUDESH_BEARER"],
    async fetch(env) {
      if (!hasLatitudeConfiguration(env)) return [];
      return crawlLatitudeInventory(env);
    }
  },
  gmiConnector,
  hyperstackConnector,
  gcoreConnector,
  {
    id: "digitalocean",
    name: "DigitalOcean",
    envVars: ["DIGITALOCEAN_TOKEN", "DIGITALOCEAN_API_TOKEN", "DO_API_TOKEN", "DIGITALOCEAN_API_KEY"],
    async fetch(env) {
      if (!hasDigitalOceanConfiguration(env)) return [];
      return crawlDigitalOceanInventory(env);
    }
  },
  {
    id: "nscale",
    name: "Nscale",
    envVars: ["NSCALE_SERVICE_TOKEN", "NSCALE_API_TOKEN", "NSCALE_TOKEN", "NSCALE_ORGANIZATION_ID", "NSCALE_ORGANIZATION_IDS"],
    async fetch(env) {
      if (!hasNscaleConfiguration(env)) return [];
      return crawlNscaleInventory(env);
    }
  },
  {
    id: "ovhcloud",
    name: "OVHcloud",
    envVars: ["OVH_APPLICATION_KEY", "OVH_APPLICATION_SECRET", "OVH_CONSUMER_KEY", "OVH_PROJECT_ID", "OVH_PUBLIC_CLOUD_PROJECT_ID", "OVH_PUBLIC_CLOUD_PROJECT_IDS"],
    async fetch(env) {
      if (!hasOvhCloudConfiguration(env)) return [];
      return crawlOvhCloudInventory(env);
    }
  },
  massedComputeConnector,
  e2eConnector,
  {
    id: "mithril",
    name: "Mithril",
    envVars: ["MITHRIL_API_KEY", "MITHRIL_TOKEN"],
    async fetch(env) {
      if (!hasMithrilConfiguration(env)) return [];
      return crawlMithrilInventory(env);
    }
  },
  togetherConnector,
  linodeConnector,
  civoConnector,
  novitaConnector,
  oblivusConnector,
  leadergpuConnector,
  thundercomputeConnector,
  outscaleConnector,
  leafcloudConnector,
  seewebConnector,
  saladcloudConnector,
  jarvislabsConnector,
  hydrahostConnector,
  sakuraConnector,
  ionosConnector,
  exabitsConnector,
  sharonaiConnector,
  atlanticnetConnector,
  gpulistConnector,
  denvrConnector,
  contaboConnector,
  hetznerConnector,
  uthoConnector,
  greennodeConnector,
  acecloudConnector,
  arkaneConnector,
  hotaisleConnector,
  hpcaiConnector,
  northflankConnector,
  hivenetConnector,
  ionstreamConnector,
  ionetConnector,
  coreweaveConnector,
  liquidwebConnector,
  qubridConnector,
  core42Connector,
  flexaiConnector,
  valdiConnector,
  farmgpuConnector,
  cirrascaleConnector,
  whitefiberConnector,
  yottalabsConnector,
  neysaConnector,
  taigaConnector,
  olakrutrimConnector,
  zonerConnector,
  neevcloudConnector,
  getdeployingConnector,
  nebulablockConnector,
  trainyConnector,
  turboscaleConnector,
  visionbayConnector,
  cloudclustersConnector,
  aironConnector,
  ax3Connector,
  catoConnector,
  cloudexeConnector,
  highresoConnector,
  nodeaiConnector,
  chargConnector,
  polarisConnector,
  slydConnector
];

// Re-exported for backwards compatibility with tests and scripts that import
// individual helpers from this module. The implementations now live in the
// per-provider modules under ./live/.
export { jsonFetch } from "./live/http.js";
export { parseMemoryGb } from "./live/format.js";
export { primeDefaultResourceHourlyPrice } from "./live/providers/prime.js";
export { cudoVmMachineTypesToItems } from "./live/providers/cudo.js";
export { tensordockLocationsToItems } from "./live/providers/tensordock.js";
export { hyperstackFlavorToItem } from "./live/providers/hyperstack.js";
export { massedInventoryToItems } from "./live/providers/massed-compute.js";
export { e2ePlansToItems } from "./live/providers/e2e.js";
export { gmiProductsToItems } from "./live/providers/gmi.js";
export { ovhCatalogPriceMap, ovhGpuSpec, ovhFlavorToItem, ovhDedupeItems } from "./live/providers/ovh.js";
export { digitaloceanSizeToItem } from "./live/providers/digitalocean.js";
export { mithrilInstanceToItem, mithrilDedupeItems } from "./live/providers/mithril.js";
