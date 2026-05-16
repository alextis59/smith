set -euo pipefail
node test.js
node --check 'src/slugify.js'
