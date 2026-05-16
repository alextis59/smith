export function filterWindow(items, start, end) {
  return items.filter((item) => item.date > start && item.date < end);
}
