set -euo pipefail
node test.js
node --check 'src/env-bool.js'
