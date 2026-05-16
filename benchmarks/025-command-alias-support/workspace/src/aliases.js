export function resolveCommand(input) {
  return String(input.name || input.command || "smith");
}
