set -euo pipefail
node test.js
node --check src/audit.js
grep -q "## Verification" README.md
