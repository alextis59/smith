set -euo pipefail
node test.js
node --check src/plugins.js
grep -q "## Verification" README.md
