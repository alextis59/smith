export function retryDelay(attempt) {
  return 100 * 2 ** attempt;
}
