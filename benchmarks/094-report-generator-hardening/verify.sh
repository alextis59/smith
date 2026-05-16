set -euo pipefail
node test.js
node --check src/reports.js
grep -q "## Verification" README.md
