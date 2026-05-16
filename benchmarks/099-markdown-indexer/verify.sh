set -euo pipefail
node test.js
node --check src/indexer.js
grep -q "## Verification" README.md
