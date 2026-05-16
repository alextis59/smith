set -euo pipefail
node test.js
node --check src/release.js
grep -q "## Verification" README.md
