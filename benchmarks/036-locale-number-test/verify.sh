set -euo pipefail
node test.js
if grep -R '1,234.50' test.js fixtures >/dev/null; then echo "old expectation still present" >&2; exit 1; fi
