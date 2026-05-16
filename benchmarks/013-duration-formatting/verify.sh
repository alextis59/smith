set -euo pipefail
node test.js
node --check 'src/format-duration.js'
