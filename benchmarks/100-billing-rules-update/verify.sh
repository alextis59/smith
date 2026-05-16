set -euo pipefail
node test.js
node --check src/billing.js
grep -q "## Verification" README.md
