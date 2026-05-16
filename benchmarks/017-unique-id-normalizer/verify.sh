set -euo pipefail
node test.js
node --check 'src/normalize-id.js'
