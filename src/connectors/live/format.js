import { numberOrNull, parseMemoryGb, round } from "../../core/num.js";
import { compactMetadata, parseEnvList } from "../../core/format.js";
import { truthyEnv } from "../../core/env.js";

export { numberOrNull, parseMemoryGb, round, compactMetadata, parseEnvList, truthyEnv };

export function resourceRange(value) {
  if (!value || typeof value !== "object") return null;
  return compactMetadata({
    min: value.minCount,
    default: value.defaultCount,
    max: value.maxCount,
    step: value.step,
    pricePerUnit: value.pricePerUnit,
    defaultIncludedInPrice: value.defaultIncludedInPrice,
    additionalInfo: value.additionalInfo
  });
}

export function formatBandwidth(down, up) {
  const parts = [];
  if (down) parts.push(`${down} Mbps down`);
  if (up) parts.push(`${up} Mbps up`);
  return parts.join(" / ");
}

export function fabricFromText(...values) {
  const text = values.filter((value) => value !== null && value !== undefined).join(" ");
  if (/\binfiniband\b|\bib\b|ndr|hdr|edr/i.test(text)) return "InfiniBand";
  if (/\brdma\b/i.test(text)) return "RDMA";
  if (/\broce\b/i.test(text)) return "RoCE";
  if (/\befa\b/i.test(text)) return "EFA";
  if (/ethernet|\bgbe\b|gigabit ethernet|internet|public ip|port forward|nic_eth|eth_|_eth/i.test(text)) return "Ethernet";
  return "Not exposed";
}

export function fabricIsExposed(value) {
  return !/^not exposed$/i.test(String(value || ""));
}

function highEndMultiGpu(gpuLabel = "", gpuCount = 0) {
  return Number(gpuCount) >= 2 && /\b(?:GB300|GB200|B300|B200|H200|H100|A100)\b/i.test(String(gpuLabel || ""));
}

export function fabricDataNote(fabric, gpuLabel, gpuCount) {
  return !fabricIsExposed(fabric) && highEndMultiGpu(gpuLabel, gpuCount)
    ? "No IB/RDMA fabric listed by provider API"
    : "";
}

export function nonNegativeNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function normalizeMbToGb(value) {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed > 512 ? Math.round(parsed / 1024) : parsed;
}

export function dailyToHourly(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed > 24 ? parsed / 24 : parsed;
}

export function centsToDollars(value, divisor = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed / 100 / divisor;
}

export function shadeformPriceToDollars(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed > 20 ? parsed / 100 : parsed;
}

export function moneyValue(value) {
  const raw = value && typeof value === "object" ? value.value : value;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function formatBitsPerSecond(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return "";
  if (parsed >= 1_000_000_000) return `${Math.round((parsed / 1_000_000_000) * 10) / 10} Gbps`;
  if (parsed >= 1_000_000) return `${Math.round((parsed / 1_000_000) * 10) / 10} Mbps`;
  return `${parsed} bps`;
}

export function bytesToGb(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round((parsed / 1024 ** 3) * 100) / 100;
}

export function firstGpu(raw) {
  if (Array.isArray(raw.gpus) && raw.gpus.length) return raw.gpus[0];
  if (Array.isArray(raw.gpu_info) && raw.gpu_info.length) return raw.gpu_info[0];
  if (Array.isArray(raw.specs?.gpus) && raw.specs.gpus.length) return raw.specs.gpus[0];
  return {};
}

export function buildGpuLabel({ count, model, vramGb, variant }) {
  const modelText = normalizeGpuModelText(model);
  const variantText = normalizeVariantText(variant);
  const vramText = vramGb ? `${Math.round(Number(vramGb))}GB` : "";
  return [
    count ? `${count}x` : "",
    modelText,
    vramText && !modelText.toLowerCase().includes(vramText.toLowerCase()) ? vramText : "",
    variantText && !modelText.toLowerCase().includes(variantText.toLowerCase()) ? variantText : ""
  ].filter(Boolean).join(" ");
}

export function normalizeGpuModelText(value) {
  return String(value || "")
    .replace(/^nvidia[-_\s]*/i, "")
    .replace(/_/g, " ")
    .replace(/-/g, " ")
    .replace(/\bgb\b/gi, "GB")
    .replace(/\bh100\b/gi, "H100")
    .replace(/\bh200\b/gi, "H200")
    .replace(/\bb200\b/gi, "B200")
    .replace(/\bb300\b/gi, "B300")
    .replace(/\ba100\b/gi, "A100")
    .replace(/\bl40s\b/gi, "L40S")
    .replace(/\bmi300x\b/gi, "MI300X")
    .replace(/\bmi325x\b/gi, "MI325X")
    .replace(/\bmi355x\b/gi, "MI355X")
    .replace(/\bpcie\b/gi, "PCIe")
    .replace(/\bsxm\b/gi, "SXM")
    .replace(/\bnvl\b/gi, "NVL")
    .replace(/\s+/g, " ")
    .trim();
}

export function cudoGpuLabel(value) {
  return normalizeGpuModelText(value);
}

export function normalizeVariantText(value) {
  const text = String(value || "");
  if (/nvlink/i.test(text)) return "SXM";
  if (/nvl/i.test(text)) return "NVL";
  if (/sxm/i.test(text)) return "SXM";
  if (/pcie|pci-e|pci e/i.test(text)) return "PCIe";
  if (/oam/i.test(text)) return "OAM";
  return "";
}
