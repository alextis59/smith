set -euo pipefail
node test.js
node --check 'src/retry-delay.js'
