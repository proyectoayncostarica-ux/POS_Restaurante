#!/usr/bin/env bash
# Iniciar servidor POS en modo desarrollo
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

LOGFILE="${TMPDIR:-/tmp}/pos-error.log"
rm -f "$LOGFILE"

if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1090
  source "$HOME/.nvm/nvm.sh"
fi

if [ ! -d node_modules ]; then
  echo "Instalando dependencias..."
  npm install
fi

echo "Iniciando servidor en modo desarrollo..."
if ! npm run dev 2> "$LOGFILE"; then
  ec=$?
  echo "Hubo un error al iniciar el servidor. Código: $ec"
  echo "Detalles guardados en: $LOGFILE"
  exit "$ec"
fi
