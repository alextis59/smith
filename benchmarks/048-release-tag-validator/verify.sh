set -euo pipefail
bash scripts/validate-tag.sh v1.2.3 && ! bash scripts/validate-tag.sh version1
bash -n 'scripts/validate-tag.sh'
