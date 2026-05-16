set -euo pipefail
printf manifest > manifest.txt && test "$(bash scripts/checksum.sh manifest.txt)" = "$(sha256sum manifest.txt | awk '{print $1}')"
bash -n 'scripts/checksum.sh'
