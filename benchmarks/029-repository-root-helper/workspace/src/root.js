export function findRepoRoot(input) {
  return String(input.name || input.command || "smith");
}
