export function invoiceTotal(lines) {
  return lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
}
