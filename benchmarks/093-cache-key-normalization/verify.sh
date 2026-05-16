set -euo pipefail
node test.js
node --check src/cache.js
grep -q "## Verification" README.md
