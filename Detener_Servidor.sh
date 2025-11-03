#!/usr/bin/env bash
set -Eeuo pipefail

# Si usas systemd:
systemctl --user stop pos-dev.service 2>/dev/null || true

# Cierra nodemon/node de este proyecto
pkill -f "nodemon server/app.js" 2>/dev/null || true
pkill -f "node server/app.js" 2>/dev/null || true

# Libera el puerto (si quedó un zombie)
fuser -k 3000/tcp 2>/dev/null || true
fuser -k 3001/tcp 2>/dev/null || true

echo "[POS] Detenido."
