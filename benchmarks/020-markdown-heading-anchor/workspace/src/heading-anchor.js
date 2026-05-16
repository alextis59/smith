export function headingAnchor(text) {
  return "#" + text.toLowerCase().replaceAll(" ", "-");
}
