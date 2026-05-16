set -euo pipefail
APP_ENV=prod bash scripts/require-env.sh | grep -qx prod && ! bash scripts/require-env.sh 2>/tmp/env.err && grep -q "APP_ENV is required" /tmp/env.err
bash -n 'scripts/require-env.sh'
