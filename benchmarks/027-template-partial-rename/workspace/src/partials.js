export function renderTemplate(input) {
  return String(input.name || input.command || "smith");
}
