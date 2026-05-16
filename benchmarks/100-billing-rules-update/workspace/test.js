import assert from "node:assert/strict";
import { calculateInvoice } from "./src/billing.js";
assert.deepEqual(calculateInvoice({units:12, discount:0.1}), {subtotal:22, total:19.8});
