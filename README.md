# MundiPOS

MundiPOS es un sistema POS web local para restaurante/bar. El backend corre con Node.js + Express y usa SQLite como base de datos local. La app está pensada para operar primero en PC/red local y evolucionar luego hacia PWA, móvil con Capacitor o sincronización cloud si el negocio lo requiere.

## Identidad y versión actual

- **Nombre oficial de la app:** MundiPOS
- **Versión visible/funcional de la app:** 2.0
- **Estado de producto:** versión funcional operativa en proceso de estabilización
- **Línea de trabajo actual:** v2.1 · Estabilidad

La versión visible para usuarios, configuración pública y metadata base de la app debe mantenerse como **2.0** hasta que se decida publicar una nueva versión funcional mayor. La línea **v2.1** no representa todavía una versión visible para usuarios finales; representa la etapa interna de estabilidad.

## Control de versionado del proyecto

Este proyecto se trabajará con versionado trazable por etapa, fase y fix.

### Etapas

| Etapa | Nombre | Descripción |
|---|---|---|
| v1 | Prototipo | Primera versión experimental del POS. |
| v2.0 | Operativa | Versión funcional con módulos, permisos y operatividad base. |
| v2.1 | Estabilidad | Etapa actual: estabilización real de módulos, flujos, datos y experiencia de uso. |

### Fases de estabilidad

Durante la etapa de estabilidad se usará el formato:

```text
v2.1.x
```

Ejemplos:

```text
v2.1.1 Auditoría y estabilización del Dashboard
v2.1.2 Zonas y mesas
v2.1.3 Pedidos y productos
v2.1.4 Pagos y liberación de mesas
v2.1.5 Créditos y abonos
```

### Fixes derivados

Si una fase introduce o revela un bug derivado, se documentará como fix:

```text
v2.1.1 fix1
v2.1.1 fix2
v2.1.2 fix1
```

Cada fix debe indicar:

```text
- Qué bug corrige.
- Qué archivo(s) toca.
- Qué flujo debe probarse.
- Qué riesgo queda pendiente, si existe.
```

## Registro de cambios canónico

### v2.1.3 · Estabilización visual del sidebar y transiciones globales

- **Objetivo:** modernizar el sidebar, el menú hamburguesa móvil y las transiciones entre módulos para que la app autenticada se sienta más fluida y coherente con el login/header actual.
- **Problema visual/UX detectado:** el sidebar mantenía una apariencia plana, el menú móvil abría/cerraba de forma brusca, los módulos cambiaban de golpe y el footer interno repetía autor/versión ya presentes en el login.
- **Archivos modificados:** `public/index.html`, `public/css/style.css`, `public/js/main.js` y `README.md`.
- **Cambios realizados en sidebar PC:** se aplicó fondo premium con degradado, profundidad, bordes sutiles, mejor espaciado, estados hover/active más claros, iconografía resaltada y microinteracción rápida al seleccionar módulos.
- **Cambios realizados en menú móvil:** se agregó overlay moderno con fade/blur, apertura y cierre por desplazamiento suave, cierre al tocar fuera, cierre al seleccionar módulo y áreas táctiles más cómodas.
- **Cambios realizados en transiciones entre módulos:** `Navigation.showSection()` ahora centraliza una transición de salida/entrada entre secciones, evita estados corruptos con `navigationTransitionId` y respeta `prefers-reduced-motion` con animaciones mínimas.
- **Elementos eliminados del sidebar/footer interno:** se retiró el bloque `Creado by Andrey Acuña` y la versión visible del sidebar, porque esa información quedó centralizada en el login institucional.
- **Pruebas realizadas/recomendadas:** validar sintaxis de `public/js/main.js`, revisar `git diff`/`git status` y probar manualmente sidebar PC, menú móvil, navegación entre Dashboard, Zonas, Menú, Cuentas, Créditos, Usuarios y Configuración.
- **Resultado esperado:** navegación lateral más profesional y compacta, menú móvil fluido, módulos con transición suave y sin cambios en rutas, sesión, permisos ni lógica backend.
- **Riesgos o pendientes:** queda pendiente validación visual en navegador/dispositivo físico para ajustar tiempos o espaciados finos si el uso real en pantallas pequeñas lo requiere.

### v2.1.2 · Estabilización visual del header principal

- **Objetivo:** mejorar la presentación del header autenticado de MundiPOS sin cambiar la lógica funcional de los módulos.
- **Problema visual/técnico detectado:** el header se veía plano, no mostraba logo, ocultaba la fecha/hora en móvil y el reloj se actualizaba con un `setInterval` global sin ciclo explícito de inicio/parada.
- **Archivos modificados:** `public/index.html`, `public/css/style.css`, `public/js/main.js` y `README.md`.
- **Cambios realizados:** se integró el logo oficial de MundiPOS, se reorganizó la jerarquía de marca/restaurante/usuario/reloj/logout y se agregó profundidad visual con fondo, bordes, sombras suaves y mejor espaciado.
- **Integración del logo oficial:** se agregó el archivo `public/assets/brand/mundipos-mark.jpg` y se usa como identidad principal en la tarjeta de login y en el header autenticado.
- **Comportamiento en PC:** el header muestra logo, nombre MundiPOS, nombre del restaurante, usuario, tipo de usuario, fecha/hora completa y botón de cierre con icono + texto.
- **Comportamiento en móvil:** el header queda compacto, muestra menú, solo el logo oficial, fecha/hora compacta en el área de contexto y botón de cierre reducido a icono; se ocultan el texto MundiPOS, el nombre del restaurante y el texto del botón.
- **Revisión del reloj/fecha/hora:** se reemplazó el intervalo global por `startHeaderClock()` y `stopHeaderClock()`, con guard contra timers duplicados, limpieza al volver al login y actualización limitada a los nodos de escritorio/móvil cuando cambia el texto.
- **Archivos modificados por integración del logo:** `public/index.html`, `public/css/style.css`, `public/assets/brand/mundipos-mark.jpg` y `README.md`.
- **Validaciones realizadas por integración del logo:** revisión de rutas/referencias del asset, validación de sintaxis JS y revisión de `git diff`/`git status`.
- **Pruebas visuales:** no se realizaron pruebas en navegador, login ni flujo visual por instrucción expresa del usuario para evitar consumo adicional.
- **Pruebas realizadas/recomendadas:** iniciar sesión, verificar header en Dashboard, cambiar entre módulos, abrir/cerrar menú móvil, cerrar sesión y repetir login/logout validando que el reloj no duplique timers. Revisar en PC y viewport móvil.
- **Resultado esperado:** header profesional, legible y responsive, con fecha/hora siempre visible en app autenticada y sin acumulación de intervalos tras login/logout.
- **Pendientes o riesgos:** queda pendiente validación visual en navegador/dispositivos físicos; conviene revisar el recorte final del logo oficial en pantallas pequeñas y con nombres de restaurante muy largos.

### v2.1.1 fix1 · Corrección de estado del botón de login al cerrar sesión

- **Objetivo:** dejar el formulario de acceso limpio y listo para una nueva autenticación después de cerrar sesión.
- **Problema corregido:** el botón permanecía deshabilitado y mostraba `Preparando panel...` al volver al login porque el estado de carga aplicado durante el ingreso exitoso no se restablecía.
- **Archivos modificados:** `public/js/main.js`, `public/index.html`, `public/css/style.css` y `README.md`.
- **Cambio realizado:** `showLogin()` restablece campos, mensajes, estado visual y contenido del botón. Además, se agregó el bloque institucional inferior del login y su versión se sincroniza con `version_app` mediante `/api/public/branding`.
- **Prueba realizada/recomendada:** iniciar sesión, confirmar la carga del Dashboard, cerrar sesión y verificar que los campos queden vacíos, el botón habilitado con el texto `Iniciar sesión` y sin la clase de carga. Repetir en vista móvil y confirmar el texto institucional con `v2.0`.
- **Resultado esperado:** el usuario puede volver a iniciar sesión inmediatamente y el bloque institucional permanece centrado, legible y fuera de la tarjeta de acceso.
- **Riesgos o pendientes:** validar posteriormente el bloque institucional en dispositivos físicos con pantallas de poca altura; no se modificaron autenticación, sesiones ni persistencia SQLite.

### v2.1.0 · Base de estabilidad inicial

- Se saneó el arranque del proyecto.
- Se retiró `node_modules` del repositorio.
- Se agregó `.gitignore` y `.env.example`.
- Se verificó el arranque con SQLite y sesión.
- Se agregó identidad visual inicial de MundiPOS.
- Se agregó endpoint público seguro para branding: `/api/public/branding`.
- Se normalizó la versión visible/funcional de la app a **2.0**.
- Se creó una referencia central de nombre y versión en `server/config/appInfo.js`.

## Regla obligatoria para futuros cambios

Todo cambio hecho en Codex o manualmente debe actualizar este README cuando altere cualquiera de estos puntos:

```text
- versión, etapa, fase o fix
- módulos funcionales
- flujo operativo
- base de datos o migraciones
- seguridad o permisos
- instalación, arranque o dependencias
- bugs corregidos o pendientes conocidos
```

Antes de cerrar cada fase o fix se debe agregar una entrada al registro de cambios.

## Requisitos

- Node.js 18 o superior
- npm
- SQLite CLI recomendado para auditoría y revisión manual de datos

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

El inicializador crea el schema completo si la base no existe. También aplica migraciones básicas sobre bases viejas, incluyendo columnas faltantes y reparación de claves foráneas heredadas.

Antes de hacer cambios grandes o usar una base vieja, crear respaldo:

```bash
cp data/restaurant.db data/backups/restaurant-$(date +%Y%m%d-%H%M%S).db
```

## Estructura principal

```text
server/app.js              # entrada del servidor
server/config/appInfo.js   # nombre oficial, versión visible y línea de estabilidad
server/db/database.js      # conexión, schema y migraciones
server/routes/             # endpoints API
public/index.html          # frontend
public/css/style.css       # estilos globales
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

## Flujo de trabajo recomendado

```text
1. Crear o confirmar fase/fix de trabajo.
2. Hacer cambios pequeños y trazables.
3. Probar flujo afectado desde la app.
4. Revisar consola del navegador y terminal del servidor.
5. Revisar datos SQLite si el cambio afecta persistencia.
6. Actualizar este README.
7. Hacer commit con mensaje claro.
```

## Notas de mantenimiento

- No subir `node_modules` al repositorio.
- No subir `.env` ni copias reales de producción.
- No subir archivos temporales de SQLite: `*.db-wal`, `*.db-shm`, `*.db-journal`.
- Mantener `data/backups/` fuera del repositorio si contiene datos reales.
- La app actual es web local; para PC puede empaquetarse después con Electron/Tauri y para móvil conviene evolucionarla primero como PWA/responsive.
