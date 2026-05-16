set -euo pipefail
node test.js
node --check src/index.js
node --check src/root.js
