import { filterWindow } from "./src/filter-window.js";
import assert from "node:assert/strict";
const items = [{ id: 1, date: "2026-01-01" }, { id: 2, date: "2026-01-15" }, { id: 3, date: "2026-02-01" }];
assert.deepEqual(filterWindow(items, "2026-01-01", "2026-01-15").map((item) => item.id), [1, 2]);
