set -euo pipefail
mkdir -p "data dir" && echo ok > "data dir/source file.txt" && bash scripts/backup.sh "data dir/source file.txt" && test "$(cat "backups/source file.txt.bak")" = ok
bash -n 'scripts/backup.sh'
