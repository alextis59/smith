set -euo pipefail
node test.js
node --check src/runner.js
grep -q "## Verification" README.md
