#!/usr/bin/env bash
# === Iniciar servidor POS (desarrollo) ===
set -Eeuo pipefail

cd "/home/andrey/restaurant-app"

# Log temporal (equivalente a redirigir stderr)
LOGFILE="${TMPDIR:-/tmp}/pos-error.log"
rm -f "$LOGFILE"

# Cargar NVM (si usas nvm) y fijar LTS por defecto
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  export NVM_DIR="$HOME/.nvm"
  . "$NVM_DIR/nvm.sh"
  nvm use --lts >/dev/null
fi

echo "[POS] Iniciando npm run dev..."
# Solo stderr al log (2>), stdout a la consola
if ! npm run dev 2> "$LOGFILE"; then
  EC=$?
  echo "[POS] Error al iniciar. Código: $EC"
  echo "[POS] Revisa: $LOGFILE"
  exit 1
fi

exit 0
