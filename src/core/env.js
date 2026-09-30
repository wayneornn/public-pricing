// Shared environment-variable coercion used by the provider crawlers. Kept
// permissive on purpose: `truthyEnv` treats any non-empty value as enabled
// unless it is an explicit falsy token ("0", "false", "no", "off"), so flags
// like `*_GPU_INVENTORY_ENABLED=on`/`=yes`/`=enabled` all turn a provider on.
export function hasEnvValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

export function truthyEnv(value) {
  return hasEnvValue(value) && !["0", "false", "no", "off"].includes(String(value).trim().toLowerCase());
}
