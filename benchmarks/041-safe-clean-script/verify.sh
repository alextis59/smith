set -euo pipefail
mkdir -p tmp/a && touch tmp/a/file tmp/a/.keep && bash scripts/clean.sh tmp/a && test -e tmp/a/.keep && test ! -e tmp/a/file
bash -n 'scripts/clean.sh'
