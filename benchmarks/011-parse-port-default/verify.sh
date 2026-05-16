set -euo pipefail
node test.js
node --check 'src/parse-port.js'
