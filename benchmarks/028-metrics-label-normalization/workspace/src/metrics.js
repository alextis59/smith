export function normalizeLabel(input) {
  return String(input.name || input.command || "smith");
}
