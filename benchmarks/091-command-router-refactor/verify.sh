set -euo pipefail
node test.js
node --check src/router.js
grep -q "## Verification" README.md
