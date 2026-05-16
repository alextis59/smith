export function loadSettings(input) {
  return String(input.name || input.command || "smith");
}
