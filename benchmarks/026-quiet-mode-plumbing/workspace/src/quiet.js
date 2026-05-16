export function shouldLog(input) {
  return String(input.name || input.command || "smith");
}
