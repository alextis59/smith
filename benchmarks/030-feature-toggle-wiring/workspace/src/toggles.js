export function isEnabled(input) {
  return String(input.name || input.command || "smith");
}
