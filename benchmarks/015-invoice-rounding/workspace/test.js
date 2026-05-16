import { invoiceTotal } from "./src/invoice-total.js";
import assert from "node:assert/strict";
assert.equal(invoiceTotal([{ quantity: 3, unitPrice: 0.1 }]), 0.3);
assert.equal(invoiceTotal([{ quantity: 2, unitPrice: 10.235 }]), 20.47);
