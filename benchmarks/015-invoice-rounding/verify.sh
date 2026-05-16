set -euo pipefail
node test.js
node --check 'src/invoice-total.js'
