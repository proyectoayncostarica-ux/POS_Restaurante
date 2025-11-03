#!/usr/bin/env bash
# === Inicio Servidor POS (modo desarrollo) ===
set -Eeuo pipefail

# Ir al directorio del proyecto
cd "/home/andrey/restaurant-app"

# Log temporal de errores (equivalente a %TEMP%\pos-error.log)
LOGFILE="${TMPDIR:-/tmp}/pos-error.log"
rm -f "$LOGFILE"

# (Opcional) Cargar nvm si usas Node instalado con nvm
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1090
  source "$HOME/.nvm/nvm.sh"
fi

echo "Iniciando servidor en modo desarrollo..."
# Ejecutar y redirigir SOLO stderr al log (como 2> en .bat)
if ! npm run dev 2> "$LOGFILE"; then
  EC=$?
  echo "Hubo un error al iniciar el servidor. Código: $EC"
  echo "Detalles guardados en: $LOGFILE"
  exit 1
fi

exit 0
