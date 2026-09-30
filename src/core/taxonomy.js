const GPU_DEFINITIONS = [
  { model: "GB300", patterns: [/\bGB300\b/i], defaultVramGb: 288, rank: 1020 },
  { model: "GB200", patterns: [/\bGB200\b/i], defaultVramGb: 186, rank: 1010 },
  { model: "B300", patterns: [/\bB300\b/i], defaultVramGb: 288, rank: 1000 },
  { model: "B200", patterns: [/\bB200\b/i], defaultVramGb: 180, rank: 960 },
  { model: "H200", patterns: [/\bH200(?:x\d+|[_-]?\d{2,3}G(?:B)?)?\b/i], defaultVramGb: 141, rank: 920 },
  { model: "GH200", patterns: [/\bGH200\b/i], defaultVramGb: 96, rank: 900 },
  { model: "H100", patterns: [/\bH100(?:x\d+|[_-]?\d{2,3}G(?:B)?)?\b/i], defaultVramGb: 80, rank: 860 },
  { model: "MI355X", patterns: [/\bMI355X\b/i], defaultVramGb: 288, rank: 855 },
  { model: "MI300X", patterns: [/\bMI300X\b/i], defaultVramGb: 192, rank: 850 },
  { model: "MI325X", patterns: [/\bMI325X\b/i], defaultVramGb: 256, rank: 845 },
  { model: "MI25", patterns: [/\bMI25\b/i], defaultVramGb: 16, rank: 760 },
  { model: "Gaudi3", patterns: [/\bGAUDI\s*3\b/i, /\bGAUDI3\b/i, /\bHL[-\s]?325\b/i], defaultVramGb: 128, rank: 830 },
  { model: "Gaudi2", patterns: [/\bGAUDI\s*2\b/i, /\bGAUDI2\b/i, /\bHL[-\s]?225\b/i], defaultVramGb: 96, rank: 745 },
  { model: "Gaudi", patterns: [/\bGAUDI\b/i, /\bHL[-\s]?205\b/i], defaultVramGb: 32, rank: 650 },
  { model: "A100", patterns: [/\bA100(?:x\d+|[_-]?\d{2,3}G(?:B)?)?\b/i], defaultVramGb: 80, rank: 740 },
  { model: "Trainium3", patterns: [/\bTRAINIUM\s*3\b/i, /\bTRAINIUM3\b/i, /\bTRN3\b/i], defaultVramGb: null, rank: 725 },
  { model: "Trainium2", patterns: [/\bTRAINIUM\s*2\b/i, /\bTRAINIUM2\b/i, /\bTRN2\b/i], defaultVramGb: null, rank: 720 },
  { model: "Trainium", patterns: [/\bTRAINIUM\b/i, /\bTRN1\b/i], defaultVramGb: null, rank: 700 },
  { model: "Inferentia2", patterns: [/\bINFERENTIA\s*2\b/i, /\bINFERENTIA2\b/i, /\bINF2\b/i], defaultVramGb: null, rank: 690 },
  { model: "Inferentia", patterns: [/\bINFERENTIA\b/i, /\bINF1\b/i], defaultVramGb: null, rank: 680 },
  { model: "L40S", patterns: [/\bL40S\b/i], defaultVramGb: 48, rank: 660 },
  { model: "L40", patterns: [/\bL40\b/i], defaultVramGb: 48, rank: 620 },
  { model: "RTX PRO 6000", patterns: [/\bRTX\s*PRO\s*6000B\b/i], defaultVramGb: 96, rank: 605 },
  { model: "RTX PRO 6000", patterns: [/\bRTX\s*PRO\s*(?:SERVER\s*)?6000\b/i, /\bPRO6000\b/i], defaultVramGb: 96, rank: 600 },
  { model: "RTX PRO 5000", patterns: [/\bRTX\s*PRO\s*5000\b/i, /\bPRO5000\b/i], defaultVramGb: 48, rank: 590 },
  { model: "RTX PRO 4500", patterns: [/\bRTX\s*PRO\s*4500\b/i, /\bPRO4500\b/i], defaultVramGb: 32, rank: 585 },
  { model: "RTX PRO 4000", patterns: [/\bRTX\s*PRO\s*4000\b/i, /\bPRO4000\b/i], defaultVramGb: 24, rank: 580 },
  { model: "RTX 5000 Ada", patterns: [/\bRTX\s*5000\s*ADA\b/i, /\bRTX\s*5000ADA\b/i, /\b5000\s*ADA\b/i], defaultVramGb: 32, rank: 570 },
  { model: "RTX 4500 Ada", patterns: [/\bRTX\s*4500\s*ADA\b/i, /\bRTX\s*4500ADA\b/i, /\b4500\s*ADA\b/i], defaultVramGb: 24, rank: 565 },
  { model: "RTX 6000 Ada", patterns: [/\bRTX\s*6000\s*ADA\b/i, /\bRTX6000ADA\b/i], defaultVramGb: 48, rank: 560 },
  { model: "RTX 6000", patterns: [/\b(?:QUADRO\s*)?RTX\s*6000\b/i, /\bRTX6000\b/i], defaultVramGb: 24, rank: 555 },
  { model: "RTX 5090", patterns: [/\bRTX\s*5090\b/i, /\bGEFORCE\s*RTX\s*5090\b/i, /\bGEFORCERTX5090\b/i, /\b5090\b/i], defaultVramGb: 32, rank: 540 },
  { model: "RTX 5080", patterns: [/\bRTX\s*5080\b/i, /\b5080\b/i], defaultVramGb: 16, rank: 520 },
  { model: "RTX 4090D", patterns: [/\bRTX\s*4090D\b/i, /\b4090D\b/i], defaultVramGb: 24, rank: 505 },
  { model: "RTX 4090", patterns: [/\bRTX\s*4090\b/i, /\b4090\b/i], defaultVramGb: 24, rank: 500 },
  { model: "RTX 4080", patterns: [/\bRTX\s*4080\b/i, /\b4080\b/i], defaultVramGb: 16, rank: 490 },
  { model: "RTX 5070 Ti", patterns: [/\bRTX\s*5070\s*TI\b/i, /\b5070\s*TI\b/i], defaultVramGb: 16, rank: 475 },
  { model: "RTX 5070", patterns: [/\bRTX\s*5070\b/i, /\b5070\b/i], defaultVramGb: 12, rank: 470 },
  { model: "RTX 5060 Ti", patterns: [/\bRTX\s*5060\s*TI\b/i, /\b5060\s*TI\b/i], defaultVramGb: 16, rank: 465 },
  { model: "RTX 5060", patterns: [/\bRTX\s*5060\b/i, /\b5060\b/i], defaultVramGb: 8, rank: 460 },
  { model: "A6000", patterns: [/\bA6000\b/i], defaultVramGb: 48, rank: 460 },
  { model: "A5000", patterns: [/\bA5000\b/i], defaultVramGb: 24, rank: 390 },
  { model: "RTX 4070 Ti", patterns: [/\bRTX\s*4070\s*(?:S\s*TI|TI|SUPER\s*TI|TI\s*SUPER)\b/i, /\b4070\s*(?:S\s*TI|TI|SUPER\s*TI|TI\s*SUPER)\b/i], defaultVramGb: 12, rank: 385 },
  { model: "RTX 4070", patterns: [/\bRTX\s*4070(?:\s*SUPER)?\b/i, /\b4070(?:\s*SUPER)?\b/i], defaultVramGb: 12, rank: 380 },
  { model: "RTX A4500", patterns: [/\bRTX\s*A4500\b/i, /\bA4500\b/i], defaultVramGb: 20, rank: 375 },
  { model: "RTX 4000 Ada", patterns: [/\bRTX\s*4000\s*ADA\b/i, /\b4000\s*ADA\b/i], defaultVramGb: 20, rank: 370 },
  { model: "RTX A4000", patterns: [/\bRTX\s*A4000\b/i, /\bA4000\b/i], defaultVramGb: 16, rank: 365 },
  { model: "A40", patterns: [/\bA40\b/i], defaultVramGb: 48, rank: 360 },
  { model: "L4", patterns: [/\bL4\b/i], defaultVramGb: 24, rank: 355 },
  { model: "A30", patterns: [/\bA30\b/i], defaultVramGb: 24, rank: 345 },
  { model: "A10", patterns: [/\bA10G?\b/i], defaultVramGb: 24, rank: 340 },
  { model: "V100S", patterns: [/\bV100S\b/i], defaultVramGb: 32, rank: 322 },
  { model: "V100", patterns: [/\bV100(?:x\d+|[_-]?\d{2,3}G(?:B)?)?\b/i], defaultVramGb: 32, rank: 320 },
  { model: "A16", patterns: [/\bA16\b/i], defaultVramGb: 16, rank: 310 },
  { model: "A2", patterns: [/\bA2\b/i], defaultVramGb: 16, rank: 305 },
  { model: "RTX 3090", patterns: [/\bRTX\s*3090\b/i, /\b3090\b/i], defaultVramGb: 24, rank: 300 },
  { model: "RTX 3080 Ti", patterns: [/\bRTX\s*3080\s*TI\b/i, /\b3080\s*TI\b/i], defaultVramGb: 12, rank: 290 },
  { model: "RTX 3080", patterns: [/\bRTX\s*3080\b/i, /\b3080\b/i], defaultVramGb: 10, rank: 280 },
  { model: "RTX 3070 Ti", patterns: [/\bRTX\s*3070\s*TI\b/i, /\b3070\s*TI\b/i], defaultVramGb: 8, rank: 270 },
  { model: "RTX 3070", patterns: [/\bRTX\s*3070\b/i, /\b3070\b/i], defaultVramGb: 8, rank: 260 },
  { model: "RTX 3060 Ti", patterns: [/\bRTX\s*3060\s*TI\b/i, /\b3060\s*TI\b/i], defaultVramGb: 8, rank: 250 },
  { model: "RTX 3060", patterns: [/\bRTX\s*3060\b/i, /\b3060\b/i], defaultVramGb: 12, rank: 240 },
  { model: "RTX 2000 Ada", patterns: [/\bRTX\s*2000\s*ADA\b/i, /\b2000\s*ADA\b/i], defaultVramGb: 16, rank: 230 },
  { model: "RTX 2080 Ti", patterns: [/\bRTX\s*2080\s*TI\b/i, /\b2080\s*TI\b/i], defaultVramGb: 11, rank: 225 },
  { model: "T4", patterns: [/\bT4\b/i], defaultVramGb: 16, rank: 220 },
  { model: "T4G", patterns: [/\bT4G\b/i], defaultVramGb: 16, rank: 219 },
  { model: "P100", patterns: [/\bP100\b/i], defaultVramGb: 16, rank: 218 },
  { model: "P4", patterns: [/\bP4\b/i], defaultVramGb: 8, rank: 216 },
  { model: "RTX 4060 Ti", patterns: [/\bRTX\s*4060\s*TI\b/i, /\b4060\s*TI\b/i], defaultVramGb: 16, rank: 215 },
  { model: "RTX 4060", patterns: [/\bRTX\s*4060\b/i, /\b4060\b/i], defaultVramGb: 8, rank: 210 },
  { model: "RTX 3050", patterns: [/\bRTX\s*3050\b/i, /\b3050\b/i], defaultVramGb: 8, rank: 205 },
  { model: "Titan RTX", patterns: [/\bTITAN\s*RTX\b/i], defaultVramGb: 24, rank: 200 },
  { model: "Titan Xp", patterns: [/\bTITAN\s*XP\b/i], defaultVramGb: 12, rank: 195 },
  { model: "Quadro RTX 8000", patterns: [/\b(?:Q|QUADRO)?\s*RTX\s*8000\b/i], defaultVramGb: 48, rank: 190 },
  { model: "K80", patterns: [/\bK80\b/i], defaultVramGb: 12, rank: 185 },
  { model: "GTX 1080 Ti", patterns: [/\bGTX\s*1080\s*TI\b/i, /\b1080\s*TI\b/i], defaultVramGb: 11, rank: 180 },
  { model: "M60", patterns: [/\bM60\b/i], defaultVramGb: 8, rank: 178 },
  { model: "GRID K520", patterns: [/\bGRID\s*K520\b/i, /\bK520\b/i], defaultVramGb: 4, rank: 176 },
  { model: "GTX 1080", patterns: [/\bGTX\s*1080\b/i, /\b1080\b/i], defaultVramGb: 8, rank: 170 },
  { model: "GTX 1660 Super", patterns: [/\bGTX\s*1660\s*SUPER\b/i, /\b1660\s*SUPER\b/i], defaultVramGb: 6, rank: 160 },
  { model: "Radeon Pro V520", patterns: [/\bRADEON\s*PRO\s*V520\b/i, /\bV520\b/i], defaultVramGb: 8, rank: 150 }
];

// GeForce / gaming-class GPUs sold to consumers. These dominate anonymous
// consumer/crypto marketplaces (e.g. vast.ai, clore.ai). Everything else —
// datacenter (H100/A100/L40/...) and professional/workstation (RTX A-series,
// RTX PRO, *-Ada, Quadro) — is treated as datacenter-grade. Used to let the team
// filter consumer supply out, not to hide it.
const CONSUMER_GPU_MODELS = new Set([
  "RTX 5090", "RTX 5080", "RTX 5070 Ti", "RTX 5070", "RTX 5060 Ti", "RTX 5060",
  "RTX 4090D", "RTX 4090", "RTX 4080", "RTX 4070 Ti", "RTX 4070", "RTX 4060 Ti", "RTX 4060",
  "RTX 3090", "RTX 3080 Ti", "RTX 3080", "RTX 3070 Ti", "RTX 3070", "RTX 3060 Ti", "RTX 3060", "RTX 3050",
  "RTX 2080 Ti",
  "Titan RTX", "Titan Xp",
  "GTX 1080 Ti", "GTX 1080", "GTX 1660 Super"
]);

// Classify a GPU as "consumer" (gaming/GeForce) vs "datacenter" (everything
// else). Falls back to a label regex when the model is Unknown so consumer GPUs
// the taxonomy doesn't recognize yet (e.g. vast.ai "RTX 4080S", "Titan V") are
// still tagged consumer rather than slipping through as datacenter.
export function gpuTier(model = "", rawLabel = "") {
  const normalizedModel = String(model || "").trim();
  if (CONSUMER_GPU_MODELS.has(normalizedModel)) return "consumer";
  if (!normalizedModel || normalizedModel === "Unknown") {
    const text = String(rawLabel || "");
    if (/\bGEFORCE\b/i.test(text) || /\bGTX\b/i.test(text) || /\bTITAN\b/i.test(text)) return "consumer";
    if (/\bRTX\s*(?:20|30|40|50)[5-9]0\b/i.test(text) && !/\b(?:A\d|RTX\s*A|PRO|ADA|QUADRO)\b/i.test(text)) return "consumer";
  }
  return "datacenter";
}

const REGION_ALIASES = [
  { canonical: "us-east", label: "US East", tests: [/\bus[\s-]?east\b/i, /\bvirginia\b/i, /\bashburn\b/i, /\batlanta\b/i, /\bnew york\b/i] },
  { canonical: "us-west", label: "US West", tests: [/\bus[\s-]?west\b/i, /\bcalifornia\b/i, /\boregon\b/i, /\bsan jose\b/i, /\blas vegas\b/i] },
  { canonical: "north-america", label: "North America", tests: [/\bus\b/i, /\busa\b/i, /\bunited states\b/i, /\bcanada\b/i, /\bnorth america\b/i] },
  { canonical: "europe", label: "Europe", tests: [/\beu\b/i, /\beurope\b/i, /\bfrance\b/i, /\bgermany\b/i, /\bnetherlands\b/i, /\buk\b/i, /\blondon\b/i, /\bparis\b/i] },
  { canonical: "asia", label: "Asia", tests: [/\basia\b/i, /\bjapan\b/i, /\bsingapore\b/i, /\bkorea\b/i, /\bindia\b/i, /\bdelhi\b/i, /\bnoida\b/i, /\bmumbai\b/i, /\bchennai\b/i, /\bbangalore\b/i, /\bbengaluru\b/i, /\bhyderabad\b/i, /\bpune\b/i, /\bkolkata\b/i] },
  { canonical: "middle-east", label: "Middle East", tests: [/\buae\b/i, /\bdubai\b/i, /\bmiddle east\b/i, /\bisrael\b/i] }
];

export function gpuDefinitions() {
  return GPU_DEFINITIONS.map((definition) => ({ ...definition }));
}

export function normalizeGpuLabel(value = "") {
  const label = String(value || "").trim();
  const match = GPU_DEFINITIONS.find((definition) => definition.patterns.some((pattern) => pattern.test(label)));
  const variant = normalizeGpuVariant(label);
  const parsedVram = parseVramGb(label);
  const definition = match || { model: "Unknown", defaultVramGb: null, rank: 0 };

  return {
    rawLabel: label,
    model: definition.model,
    variant,
    canonicalName: [definition.model, variant !== "Unknown" ? variant : ""].filter(Boolean).join(" "),
    vramGbEach: parsedVram ?? definition.defaultVramGb,
    rank: definition.rank,
    tier: gpuTier(definition.model, label)
  };
}

export function normalizeGpuVariant(value = "") {
  const text = String(value || "");
  if (/\bNVL\b/i.test(text)) return "NVL";
  if (/\bSXM(?:\d)?\b/i.test(text) || /\bHGX\b/i.test(text)) return "SXM";
  if (/\bPCI[\s-]?E\b/i.test(text) || /\bPCIE\b/i.test(text)) return "PCIe";
  if (/\bOAM\b/i.test(text)) return "OAM";
  return "Unknown";
}

export function parseVramGb(value = "") {
  const text = String(value || "");
  const explicit = text.match(/(?:VRAM|HBM\d?)?\s*(\d{2,3})\s*G(?:B)?\b/i);
  if (!explicit) return null;
  const parsed = Number(explicit[1]);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export function extractGpuCount(value = "", fallback = 1) {
  const text = String(value || "");
  const patterns = [
    /(\d+)\s*x\s*(?:NVIDIA\s*)?(?:INTEL\s*)?(?:GEFORCE\s*)?(?:GB300|GB200|B300|B200|H200|GH200|H100|MI355X|MI325X|MI300X|GAUDI3|GAUDI2|GAUDI|A100|L40S|L40|L4|RTX|GTX|TITAN|QUADRO|A6000|A5000|A4500|A4000|A40|A30|A16|A10G?|A2|V100|P100|P4|T4|K80)/i,
    /(?:GB300|GB200|B300|B200|H200|GH200|H100|MI355X|MI325X|MI300X|GAUDI3|GAUDI2|GAUDI|A100|L40S|L40|L4|RTX|GTX|TITAN|QUADRO|A6000|A5000|A4500|A4000|A40|A30|A16|A10G?|A2|V100|P100|P4|T4|K80).*?\bx\s*(\d+)/i,
    /\b(\d+)\s*(?:GPUS?|GPU)\b/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return Number(match[1]);
  }
  return fallback;
}

export function normalizeRegion(value = "") {
  const raw = String(value || "").trim();
  if (!raw) {
    return { raw: "", canonical: "unknown", label: "Unknown" };
  }

  const alias = REGION_ALIASES.find((candidate) => candidate.tests.some((pattern) => pattern.test(raw)));
  if (alias) {
    return { raw, canonical: alias.canonical, label: alias.label };
  }

  return { raw, canonical: slugify(raw), label: raw };
}

export function normalizeProviderId(value = "") {
  return slugify(String(value || "unknown"));
}

export function slugify(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";
}

export function inferCountry(regionValue = "") {
  const text = String(regionValue || "").toLowerCase();
  if (/\bus\b|usa|united states|virginia|oregon|california|atlanta|ashburn/.test(text)) return "US";
  if (/canada|toronto|montreal/.test(text)) return "CA";
  if (/france|paris|marseille/.test(text)) return "FR";
  if (/germany|frankfurt|berlin/.test(text)) return "DE";
  if (/netherlands|amsterdam/.test(text)) return "NL";
  if (/uk|london|united kingdom/.test(text)) return "GB";
  if (/singapore/.test(text)) return "SG";
  if (/japan|tokyo/.test(text)) return "JP";
  if (/india|delhi|noida|mumbai|chennai|bangalore|bengaluru|hyderabad|pune|kolkata/.test(text)) return "IN";
  return "";
}
