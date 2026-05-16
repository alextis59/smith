set -euo pipefail
node test.js
node --check 'src/filter-window.js'
