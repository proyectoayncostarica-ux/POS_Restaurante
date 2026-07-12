#!/usr/bin/env bash
# Iniciar servidor POS en modo desarrollo
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

LOGFILE="${TMPDIR:-/tmp}/pos-error.log"
rm -f "$LOGFILE"

if [ -s "$HOME/.nvm/nvm.sh" ]; then
  export NVM_DIR="$HOME/.nvm"
  # shellcheck disable=SC1090
  . "$NVM_DIR/nvm.sh"
  nvm use --lts >/dev/null 2>&1 || true
fi

if [ ! -d node_modules ]; then
  echo "[POS] Instalando dependencias..."
  npm install
fi

echo "[POS] Iniciando npm run dev..."
if ! npm run dev 2> "$LOGFILE"; then
  ec=$?
  echo "[POS] Error al iniciar. Código: $ec"
  echo "[POS] Revisa: $LOGFILE"
  exit "$ec"
fi
