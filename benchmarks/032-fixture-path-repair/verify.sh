set -euo pipefail
node test.js
if grep -R 'fixtures/input.txt' test.js fixtures >/dev/null; then echo "old expectation still present" >&2; exit 1; fi
