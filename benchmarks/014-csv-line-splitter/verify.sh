set -euo pipefail
node test.js
node --check 'src/split-csv-line.js'
