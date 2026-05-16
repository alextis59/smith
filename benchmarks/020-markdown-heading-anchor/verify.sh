set -euo pipefail
node test.js
node --check 'src/heading-anchor.js'
