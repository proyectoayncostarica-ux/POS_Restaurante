# POS Restaurante

Sistema POS web local para restaurante/bar. El backend corre con Node.js + Express y usa SQLite como base de datos local.

## Requisitos

- Node.js 18 o superior
- npm

## Instalación limpia

```bash
npm install
cp .env.example .env
npm start
```

Abrir la app en:

```text
http://localhost:3000/POS
```

Usuario inicial cuando la base está vacía:

```text
Usuario: admin
Contraseña: admin123
```

Cambia esa contraseña desde la sección de usuarios/configuración antes de usar el sistema en producción.

## Variables de entorno

Copia `.env.example` como `.env` y ajusta lo necesario:

```text
PORT=3000
SESSION_SECRET=cambia-esta-clave
DB_PATH=./data/restaurant.db
CORS_ORIGINS=
NODE_ENV=development
COOKIE_SECURE=false
```

`CORS_ORIGINS` puede quedar vacío para uso local. Si se publica la API detrás de un dominio, agregar los orígenes separados por coma.

## Base de datos

La base se guarda por defecto en:

```text
data/restaurant.db
```

El inicializador ahora crea el schema completo si la base no existe. También aplica migraciones básicas sobre bases viejas, incluyendo columnas faltantes y reparación de claves foráneas heredadas.

Antes de hacer cambios grandes o usar una base vieja, crear respaldo:

```bash
cp data/restaurant.db data/backups/restaurant-$(date +%Y%m%d-%H%M%S).db
```

## Estructura principal

```text
server/app.js              # entrada del servidor
server/db/database.js      # conexión, schema y migraciones
server/routes/             # endpoints API
public/index.html          # frontend
public/js/main.js          # utilidades globales y sesión
public/js/components/      # pantallas del POS
public/uploads/            # imágenes subidas
```

## Scripts

```bash
npm start       # iniciar servidor
npm run dev     # iniciar con nodemon
```

En Windows también puedes usar `Inicio_Servidor.bat`. En Linux/macOS puedes usar `Inicio_Servidor.sh` o `start_dev.sh`.

## Notas de mantenimiento

- No subir `node_modules` al repositorio.
- No subir `.env` ni copias reales de producción.
- Mantener `data/backups/` fuera del repositorio si contiene datos reales.
- La app actual es web local; para PC puede empaquetarse después con Electron/Tauri y para móvil conviene evolucionarla primero como PWA/responsive.
