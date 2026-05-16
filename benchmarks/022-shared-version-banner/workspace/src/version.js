export function versionBanner(input) {
  return String(input.name || input.command || "smith");
}
