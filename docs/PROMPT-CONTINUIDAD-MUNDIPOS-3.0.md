# Prompt de continuidad canónico · MundiPOS 3.0

**Actualizado:** 18 de julio de 2026
**Estado funcional preparado para validación:** `v3.4.2`
**Próxima fase funcional:** `v3.5.0 · Dashboard y reportes financieros consolidados`
**Repositorio local activo:** `C:\Repos\POS_Restaurante`

> **Uso en un nuevo chat:** adjunta este archivo junto con un ZIP nuevo del repositorio actual y pega la sección **“Prompt listo para usar”** como primer mensaje. Este documento reemplaza el prompt de continuidad anterior. Conserva sus contratos útiles, corrige su estado obsoleto e incorpora la recuperación, normalización y limpieza realizadas el 17 de julio de 2026.

---

# Prompt listo para usar

Estás continuando el desarrollo de **MundiPOS / POS Restaurante**, una aplicación Node.js, Express, SQLite, JavaScript vanilla y PWA para restaurantes y bares.

Debes trabajar de forma incremental, auditable y compatible con la operación real. No programes a partir de recuerdos, nombres de fases o ZIP antiguos: primero confirma el estado real del ZIP más reciente y de la salida Git que proporcionaré.

## Orden obligatorio antes de modificar código

1. Lee por completo este archivo y los documentos canónicos de la fase.
2. Parte del `HEAD` publicado `329e89bc5b4352e11a4b59847c411fd447e872a7` o de un commit posterior confirmado por el usuario.
3. Confirma rama `main`, sincronización con `origin/main` y árbol limpio antes de aplicar una nueva entrega.
4. Mantén `data/restaurant.db` local, ignorada y fuera de cualquier ZIP o commit.
5. Trabaja con el flujo rápido aprobado: implementación → pruebas específicas → suite completa → validación operativa → Git seguro.
6. La fase implementada más reciente es `v3.4.2 · Configuración → Impresoras`. Las entregas `v3.4.0`, `v3.4.1` y `v3.4.2` pueden permanecer pendientes de validación/publicación y deben comprobarse en orden antes de sus commits individuales.
7. Printing debe persistir trabajos e intentos sin recalcular negocio. Una falla de dispositivo no revierte ni duplica el documento origen.
8. No uses staging global: los commits se preparan con rutas explícitas y solo después de la validación operativa.

Mantén sin cambios los contratos de cuenta global, división, Caja, Payments, créditos, finalización de servicio, impresión posterior a la persistencia, autorización backend e idempotencia. No adelantes Dashboard/reportes de `v3.5.0` ni limpieza legacy sin autorización del usuario.

Trabaja en español. En tareas de PowerShell entrega un solo bloque por turno y espera la salida completa. Nunca uses `git add .`, `git add -A`, `git clean`, `git reset --hard`, `git commit -a`, `stash pop`, `stash apply`, `stash drop`, `npm audit fix --force` ni force-push sin autorización expresa.

---

# 1. Identidad, propósito y repositorios

**Proyecto:** MundiPOS / POS Restaurante
**Stack:** Node.js, Express, SQLite, frontend JavaScript vanilla y PWA.
**Objetivo de MundiPOS 3.0:** separar dominios operativos y financieros sin romper innecesariamente la experiencia existente.

Repositorio activo:

```text
C:\Repos\POS_Restaurante
```

Repositorio anterior dentro de OneDrive, solo como respaldo histórico y no apto para desarrollo:

```text
C:\Users\andre\OneDrive\Documentos\Proyecto\POSRestaurante\POS_Restaurante_RESPALDO_NO_USAR
```

No regreses `.git` a OneDrive. No uses el repositorio antiguo como fuente de implementación ni mezcles sus archivos con el actual.

## Entorno auxiliar conservado fuera del repositorio

Después de limpiar los artefactos de recuperación, `C:\Repos` quedó reducido esencialmente a:

```text
C:\Repos\POS_Restaurante
C:\Repos\SQLiteTools
C:\Repos\RECOVERY_KEEP_20260717.zip
```

Herramienta genérica de integridad SQLite:

```text
C:\Repos\SQLiteTools\verificar-integridad-sqlite.cjs
SHA256: EA9B9ECB789EBC415FEC714C5B3FBEA9178AA582E801B54A352DF8CFF1B0F43B
```

Uso previsto, solo lectura:

```powershell
node C:\Repos\SQLiteTools\verificar-integridad-sqlite.cjs `
  C:\Repos\POS_Restaurante\data\restaurant.db `
  C:\Repos\POS_Restaurante
```

Paquete privado de preservación de recuperación:

```text
C:\Repos\RECOVERY_KEEP_20260717.zip
SHA256: D92610D5DF3C490E4FA29ECF0BDFE172695510BD35B19040E3F66C27B9B55B5D
```

Ese ZIP contiene bases y evidencia de recuperación. Debe permanecer privado, fuera del repositorio y fuera de GitHub. No solicitar su contenido salvo que exista una nueva emergencia de recuperación de datos.

---

# 2. Estado Git exacto al cerrar este chat

Último estado observado:

```text
Rama activa: main
main:        75a5a44
origin/main: 75a5a44
Árbol:       limpio
Divergencia: 0 0
```

Últimos commits observados:

```text
75a5a44 docs: documenta recuperacion y normalizacion Git v3.2.5
a39555a Pwndiente
d5edf05 merge: integra historial de main preservando v3.2.5 reconstruida
```

## Advertencia sobre `a39555a`

El commit `a39555a` aparece con el mensaje `Pwndiente`. Su contenido no fue identificado durante este traspaso. Antes de afirmar que el `HEAD` actual mantiene exactamente el árbol funcional validado, inspecciona:

```powershell
git show --stat --summary a39555a
git show --name-status --format=fuller a39555a
git diff d5edf05..a39555a --
```

Clasifica cada archivo como funcional, documental, sensible o accidental. Si el commit es accidental, no lo reviertas ni reescribas automáticamente: presenta evidencia y propone la acción segura.

## Referencias de seguridad conservadas

```text
backup/main-antes-reconstruccion         → 141735c
backup/recovery-v3.2.5-antes-integracion → b317d52
recovery/v3.1.3-a-v3.2.5                 → d5edf05
```

Stash conservado:

```text
stash@{0}: On main: RECOVERY v3.2.1 a v3.2.5 antes de reconstruir 20260717-111223
```

No apliques ni elimines el stash automáticamente. No borres las ramas de respaldo durante el inicio del nuevo chat. Ocupan poco espacio y conservan puntos de comparación útiles.

---

# 3. Recuperación y normalización realizadas

La recuperación fue necesaria porque el código de `v3.2.1` a `v3.2.5` existía en ZIP y cambios locales, mientras `main` y `origin/main` permanecían en `v3.2.0 fix2` (`141735c`).

Se trabajó en:

```text
recovery/v3.1.3-a-v3.2.5
```

Cada fase fue inspeccionada, importada de forma explícita, validada, comprometida y comparada antes de avanzar.

## Commits funcionales reconstruidos

```text
4107e50 v3.2.1: agrega API y read model operativo de Caja
a09e7b6 v3.2.2: agrega interfaz de Caja y modal operativo de cobro
417258d v3.2.3: agrega efectivo tarjeta vuelto y pagos mixtos
9598fff v3.2.4: integra creditos con Payments y cuenta global
b317d52 v3.2.5: finaliza servicio y libera mesas integralmente
```

Cadena funcional recuperada completa:

```text
fde48ee v3.1.3 · Emisión guiada de prefacturas divididas
b686b82 v3.1.4 · Continuidad de cuentas después de pagos
20e079e v3.1.5 · Read model financiero consolidado
6973218 v3.2.0 · Payments por prefactura
0721a08 v3.2.0 fix1 · Dependencias compatibles
ba0636b v3.2.0 fix2 · Exclusión de SQLite operativo
da5deaa v3.2.0 fix3 · Driver SQLite y script PowerShell
4107e50 v3.2.1 · API y read model de Caja
a09e7b6 v3.2.2 · Caja visual y modal de cobro
417258d v3.2.3 · Medios de pago
9598fff v3.2.4 · Créditos integrados
b317d52 v3.2.5 · Finalización del servicio
d5edf05 Integración normalizada en main
```

## Validación confirmada sobre el árbol funcional recuperado

```text
serviceFinalization: 6/6
creditService:       10/10
cashUiWorkflow:       7/7
sqlite driver:        2/2
suite completa:     107/107
npm audit producción: 0 vulnerabilidades
```

Versiones confirmadas durante la recuperación:

```text
package.json: 3.2.5
sqlite3:      6.0.1
Node engine:  >=20.17.0
```

La recuperación funcional fue confirmada antes de la integración. El nuevo chat debe volver a ejecutar las pruebas en el `HEAD` actual debido al commit `a39555a` y a cualquier saneamiento posterior.

## Normalización del historial

Las ramas tenían commits equivalentes con hashes distintos. Se compararon árboles y parches:

```text
cfd4c4e ↔ b686b82  árboles idénticos
d57b3be ↔ 6973218  árboles idénticos
141735c ↔ ba0636b  árboles idénticos
e6bc0af ↔ 20e079e  solo diferencias de líneas en blanco documentales
```

Se creó el respaldo:

```text
backup/recovery-v3.2.5-antes-integracion → b317d52
```

Luego se conectó el historial de `main` preservando exactamente el árbol recuperado:

```powershell
git merge --strategy=ours main -m "merge: integra historial de main preservando v3.2.5 reconstruida"
```

Commit:

```text
d5edf05
```

Árbol antes y después:

```text
36588e6a0108dc93568dbf9ae686a9ce53dea919
```

Después `main` avanzó mediante `git merge --ff-only` y fue publicado sin force-push.

## Documentación de la recuperación

Documento canónico ya comprometido:

```text
docs/README-recuperacion-normalizacion-git-v3.2.5.md
```

Commit observado:

```text
75a5a44 docs: documenta recuperacion y normalizacion Git v3.2.5
```

---

# 4. Recuperación SQLite y limpieza local realizada

Durante la normalización de `sqlite3@6.0.1` se detectó un conjunto SQLite/WAL que requirió una recuperación controlada. Se preservaron el conjunto origen, el conjunto activo problemático y una instantánea consistente.

La base activa vigente es:

```text
C:\Repos\POS_Restaurante\data\restaurant.db
```

Debe estar ignorada y no rastreada:

```powershell
git ls-files -- data/restaurant.db
git check-ignore -v data/restaurant.db
```

`git ls-files` debe quedar vacío. `git check-ignore` debe indicar la regla correspondiente.

Se eliminaron del directorio `C:\Repos` los artefactos temporales ya preservados:

```text
_recovery\
phase-zips\
carpetas de inspección v3.2.1 a v3.2.5
scripts de restauración específicos
scripts de staging específicos
inventarios temporales
copias sueltas duplicadas
```

No intentes reconstruir esas carpetas ni volver a ejecutar los scripts antiguos. Algunos podían reemplazar la base activa o dependían de ramas y ZIP que ya no existen.

---

# 5. Higiene Git pendiente y prioritaria

El `git archive` del repositorio mostró tres bases históricas todavía rastreadas, aunque `.gitignore` contenga `data/backups/`:

```text
data/backups/backup-2025-07-06T07-14-23-209Z.db
data/backups/backup-before-reset-2025-07-10T00-07-14-393Z.db
data/backups/backup-before-reset-2025-07-14T14-59-31-972Z.db
```

También se observó un archivo rastreado bajo:

```text
.vscode/settings.json
```

## Regla clave

`.gitignore` no deja de rastrear archivos agregados previamente. Por ello esos `.db`:

- existen en el árbol publicado;
- son incluidos por `git archive`;
- pueden estar presentes en el historial remoto;
- no deben incluirse en futuros ZIP de implementación;
- no deben borrarse del disco local durante el saneamiento sin una copia verificada.

## Procedimiento esperado

Antes de Kitchen:

1. Confirma que los tres archivos continúan rastreados.
2. No abras ni expongas datos personales en el chat.
3. Verifica que exista una copia privada fuera del repositorio.
4. Propón retirar del índice únicamente las rutas explícitas, preservando archivos locales si todavía se necesitan.
5. Revisa `.gitignore` y corrige reglas solo si hace falta.
6. Comprueba el staging con filtro de seguridad.
7. Crea un commit de higiene separado.
8. Explica que retirar del índice no purga el historial antiguo.
9. Si el contenido es sensible, presenta una estrategia separada de remediación histórica; no ejecutes `filter-repo`, BFG, force-push ni rotación de referencias sin aprobación explícita.
10. Repite `git archive` o inspección equivalente y confirma que los nuevos ZIP no incluyen bases.

No mezcles esta higiene con el commit funcional de Kitchen.

---

# 6. Documentos obligatorios

Dentro del ZIP/repositorio actualizado, lee en este orden:

```text
README.md
docs/README-v3.0.md
docs/roadmap-v3.0-arquitectura-modular.md
docs/PROMPT-CONTINUIDAD-MUNDIPOS-3.0.md
docs/README-recuperacion-normalizacion-git-v3.2.5.md
```

Contratos:

```text
docs/contrato-v3.0-compatibilidad-ui.md
docs/contrato-v3.0-operacion-caja-prefacturas.md
docs/contrato-v3.0-cuenta-global-fuente-financiera.md
```

Auditorías:

```text
docs/auditoria-v3.0.0-arquitectura-modular.md
docs/auditoria-v3.0.0-fix1-caja-prefacturas-subcuentas.md
```

Avances principales:

```text
docs/avance-v3.0.1-infraestructura-transaccional-pruebas.md
docs/avance-v3.0.2-capacidades-cajero-navegacion.md
docs/avance-v3.0.3-acceso-operativo-realtime.md

docs/avance-v3.1.0-cuenta-global-servicio-cuentas.md
docs/avance-v3.1.1-lineas-consumo-cantidades.md
docs/avance-v3.1.2-secuencias-prefacturas.md
docs/avance-v3.1.3-division-subcuenta.md
docs/avance-v3.1.4-continuidad-consumo.md
docs/avance-v3.1.5-read-model-financiero.md

docs/avance-v3.2.0-payments-prefactura.md
docs/avance-v3.2.0-fix2-sqlite3.md
docs/avance-v3.2.0-fix2-hotfix-script-sqlite3.md
docs/avance-v3.2.1-api-read-model-caja.md
docs/avance-v3.2.2-caja-visual-modal-cobro.md
docs/avance-v3.2.3-medios-pago.md
docs/avance-v3.2.4-creditos-payments.md
docs/avance-v3.2.5-finalizacion-servicio.md
```

Menú v2.2.5M también está cerrado y no debe revertirse. Revisa sus documentos solo cuando Kitchen dependa de destino, producto, categoría, subcategoría o presentación.

No inventes archivos faltantes. Algunos nombres pueden variar ligeramente; resuélvelos mediante el contenido real.

---

# 7. Código que debe inspeccionarse antes de Kitchen

Archivos generales:

```text
package.json
package-lock.json
.gitignore
server/config/appInfo.js
server/db/database.js
server/app.js
```

Servicios ya implementados:

```text
server/services/transactionService.js
server/services/capabilityService.js
server/services/operationalAccessService.js
server/services/accountService.js
server/services/preinvoiceService.js
server/services/documentSequenceService.js
server/services/paymentService.js
server/services/creditService.js
server/services/cashReadService.js
server/services/financialReadService.js
server/services/serviceFinalizationService.js
```

Rutas:

```text
server/routes/orders.js
server/routes/cash.js
server/routes/accounts.js
server/routes/credits.js
server/routes/dashboard.js
server/utils/realtime.js
```

Frontend/PWA:

```text
public/js/components/orders.js
public/js/components/cash.js
public/js/components/accounts.js
public/js/components/dashboard.js
public/service-worker.js
public/index.html
public/css/style.css
```

Para Kitchen, busca en todo el código vigente:

```text
comandas
comanda
cocina
bar
preparacion / preparación
enviar / reenviar
anulacion / anulación
fecha_impresion
estado_impresion
estado_operativo
printComanda
Orders.printComanda
productos_comanda
requiere_cocina
requiere_bar
destino
```

No reutilices hallazgos de auditorías antiguas sin comprobar que siguen presentes.

---

# 8. Contrato de negocio inmutable

## 8.1 Cuenta global como única fuente financiera

La cuenta global de la mesa o banco es la única venta financiera real.

```text
Cuenta global
├── cliente principal
├── mesa o banco
├── zona
├── mesero/salonero/bartender responsable
├── consumo completo
├── prefacturas operativas
├── pagos
├── créditos
├── total global
├── total pagado consolidado
└── saldo consolidado
```

Ejemplo:

```text
Mesa 1
Cliente principal: Juan
Responsable: Andrey
Total global: ₡5.000

Prefactura Pedro: ₡3.000
Prefactura Juan:  ₡2.000
```

Contabilidad:

```text
1 venta global de ₡5.000
2 documentos operativos
2 movimientos de Caja que suman ₡5.000
```

Nunca contabilices dos ventas independientes de ₡3.000 y ₡2.000.

Los pagadores parciales no reemplazan al cliente principal, responsable, mesa, zona ni número de cuenta global.

## 8.2 División una subcuenta a la vez

La división se realiza desde `Ver pedido` por el personal de atención:

1. activar `Cuenta dividida`;
2. seleccionar ítems de un cliente;
3. elegir cantidad cuando una línea tenga más de una unidad;
4. revisar subtotal, servicio y total parcial;
5. pulsar `Emitir prefactura`;
6. abrir minimodal;
7. escribir nombre del pagador;
8. mostrar ítems, cantidades y total;
9. `Volver` no escribe ni consume numeración;
10. `Imprimir y emitir` persiste una sola prefactura;
11. repetir con el consumo restante.

No prepares varias subcuentas simultáneamente.

```text
cantidad_disponible
= cantidad_consumida
- cantidad_asignada_a_prefacturas_activas
```

Una unidad no puede pertenecer a dos prefacturas válidas.

## 8.3 Continuidad después del pago

Pagar una prefactura no cierra la mesa.

El sistema debe ocultar del consumo activo las cantidades documentadas/pagadas, conservar historial, mantener cuenta abierta y permitir consumo posterior.

Puede existir:

```text
estado_operativo = abierta
estado_financiero = conciliada
saldo = 0
```

## 8.4 Finalización explícita

Saldo cero no significa mesa libre. La liberación ocurre únicamente con:

```text
Finalizar servicio
```

El backend valida transaccionalmente:

- consumos disponibles sin prefacturar;
- cantidades reservadas sin documento;
- prefacturas emitidas o parciales;
- pagos pendientes;
- saldo global;
- créditos incompletos o no formalizados;
- conflicto de versión o concurrencia.

Un crédito formalizado puede permitir liberar la mesa aunque la deuda continúe en cartera.

## 8.5 Separación de dominios

```text
Orders / Cuentas
- atención y consumo;
- cuenta global;
- líneas y cantidades;
- solicitud de envío a Kitchen;
- emisión de prefacturas;
- finalización del servicio.

Caja
- interfaz del cajero;
- búsqueda de prefacturas;
- cobro;
- efectivo, vuelto, tarjeta y mixtos;
- reimpresión autorizada;
- formalización de crédito.

Payments
- servicio interno;
- idempotencia;
- mutaciones monetarias;
- componentes de pago;
- saldos por prefactura;
- consolidación global;
- nunca libera mesa.

Kitchen
- contenido y estado operativo de comandas;
- destinos cocina/bar;
- preparación;
- altas, ajustes y anulaciones;
- tiempos y responsables.

Printing
- servicio interno futuro;
- plantillas y trabajos persistentes;
- intentos, errores y reintentos;
- no decide reglas de Orders, Payments o Kitchen.

Settings
- configuración de impresoras dentro de Configuración.
```

Payments y Printing no aparecen como módulos técnicos en navegación. Caja sí es visible para usuarios autorizados.

## 8.6 Roles y capacidades

`usuarios.tipo` mantiene conceptos generales; Cajero es rol/capacidad operativa.

Combinaciones válidas:

```text
Cajero exclusivo
Salonero
Bartender
Salonero + Cajero
Bartender + Cajero
Administrador
```

Capacidades relevantes:

```text
orders.operate
orders.split
orders.issue_preinvoice
orders.finalize_service
cash.access
cash.collect
cash.reprint
cash.reverse
kitchen.operate
printing.configure
printing.retry
```

Ocultar botones no sustituye autorización backend.

## 8.7 Impresión

Orden obligatorio:

```text
persistir documento
→ confirmar transacción de negocio
→ crear/solicitar trabajo de impresión
→ intentar imprimir
```

Una falla de impresión no revierte un pago, no duplica prefactura, no consume nueva numeración y debe ser reintentable/auditable.

---

# 9. Arquitectura ya implementada

Verifica su existencia antes de reutilizarla.

## Infraestructura

- transacciones SQLite reutilizables;
- `BEGIN IMMEDIATE` para mutaciones críticas;
- savepoints;
- callbacks posteriores a commit/rollback;
- errores de dominio con códigos estables;
- utilidades monetarias;
- idempotencia;
- pruebas con SQLite temporal;
- control de concurrencia.

## Acceso operativo

- capacidades persistentes;
- Cajero sin zona obligatoria;
- navegación autorizada;
- destino inicial Caja;
- roles combinables;
- filtros por zona y responsabilidad;
- realtime filtrado.

## Cuenta global y documentos

- cuenta `CTA-########`;
- estados operativo y financiero separados;
- snapshots de cliente, mesa, zona y responsables;
- líneas estables y cantidades;
- snapshots de producto, presentación, precio y servicio;
- prefacturas `PF-########`;
- ítems persistentes e historial;
- anulación interna;
- emisión idempotente.

## Caja y Payments

- pagos `PG-########`;
- pagos parciales/completos por prefactura;
- efectivo, vuelto, tarjeta y mixtos;
- medios persistentes;
- reversos auditables;
- API/read model/UI de Caja;
- movimientos separados de ventas globales.

## Créditos

- créditos `CR-########`;
- formalización desde prefactura;
- autorización administrativa;
- apertura como liquidación de venta;
- abonos como cobro de crédito;
- cartera e historial;
- sin doble contabilización.

## Finalización

```text
server/services/serviceFinalizationService.js
GET  /api/orders/:id/finalization
POST /api/orders/:id/finalize-service
```

Debe cerrar cuenta y liberar mesa de forma atómica, conservando historial.

---

# 10. Historial de fases

## Menú v2.2.5M cerrado

Incluye:

- productos operativos;
- presentaciones y precios;
- estados activo/inactivo;
- protección administrativa;
- tipos y grupos;
- correcciones de modales;
- resumen móvil compacto;
- normalización visual;
- integración Menu → Orders;
- pruebas y limpieza legacy;
- plantillas Excel;
- imágenes por presentación.

No lo rediseñes durante Kitchen salvo defecto demostrado.

## MundiPOS 3.0 realizado

```text
v3.0.0       Auditoría y contrato arquitectónico
v3.0.0 fix1  Auditoría Caja, prefacturas y subcuentas
v3.0.0 fix2  Fuente financiera única y roadmap
v3.0.1       Infraestructura transaccional y pruebas
v3.0.2       Capacidades, Cajero y navegación
v3.0.3       Acceso operativo y realtime

v3.1.0       Cuenta global y servicio de Cuentas
v3.1.1       Líneas y cantidades disponibles
v3.1.2       Secuencias y modelo de prefacturas
v3.1.3       División una subcuenta a la vez
v3.1.4       Continuidad del consumo
v3.1.5       Read model financiero consolidado

v3.2.0       Payments por prefactura
v3.2.0 fix1  Dependencias compatibles de seguridad
v3.2.0 fix2  Exclusión de SQLite operativo
v3.2.0 fix3  sqlite3 6.0.1 y compatibilidad Node
v3.2.1       API y read model de Caja
v3.2.2       Caja visual y modal de cobro
v3.2.3       Efectivo, vuelto, tarjeta y mixtos
v3.2.4       Créditos integrados con Payments
v3.2.5       Finalización y liberación integral
```

---

# 11. Entorno local, HTTPS y PWA

Último Node reportado previamente:

```text
Node.js v24.16.0
```

No lo asumas: verifica.

Objetivos vigentes:

```text
sqlite3 6.0.1
Node >=20.17.0
```

Comandos:

```powershell
node -v
npm -v
npm ls sqlite3 --depth=0
npm run test:sqlite-driver
npm audit --omit=dev
```

No ejecutes `npm audit fix --force`.

HTTPS/PWA:

```text
https://localhost:3000/POS/
https://192.168.0.2:3000/POS/
```

Certificados locales ignorados:

```text
.env
certs/
*.pem
*.key
public/mundipos-rootCA.crt
```

No los sobrescribas, elimines, empaquetes ni solicites.

Cuando cambien assets frontend o `public/service-worker.js`, actualiza el caché PWA para evitar clientes móviles con código obsoleto.

Si aparece `EADDRINUSE`, identifica y detén la instancia anterior. No cambies puerto/IP por conveniencia.

---

# 12. Método obligatorio por fase

## Paso 1 · Confirmar punto de partida

- leer documentación;
- inspeccionar commit `a39555a`;
- confirmar rama, versión y estado;
- revisar cambios no comprometidos;
- verificar DB ignorada;
- revisar dependencias y pruebas;
- identificar adaptadores legacy.

## Paso 2 · Resolver higiene Git pendiente

- retirar respaldos del índice de forma controlada;
- preservar copias privadas;
- no mezclar con Kitchen;
- no reescribir historial sin aprobación;
- verificar que un ZIP nuevo no incluya bases.

## Paso 3 · Auditar dominio

Documentar:

- comportamiento actual;
- responsabilidades mezcladas;
- tablas/columnas;
- rutas/componentes;
- riesgos de migración;
- permisos;
- realtime;
- impresión;
- pruebas existentes/faltantes.

## Paso 4 · Definir alcance y no alcance

Especificar:

- objetivo;
- cambios incluidos/excluidos;
- dependencias;
- invariantes;
- criterios de aceptación;
- rollback.

## Paso 5 · Diseñar migración segura

- idempotencia;
- sin pérdida de datos;
- backfill controlado;
- índices y claves;
- compatibilidad legacy;
- copia de base operativa;
- `PRAGMA integrity_check`;
- rollback documentado.

No elimines tablas históricas en transición.

## Paso 6 · Implementar por servicios

- routers delgados;
- lógica en servicios;
- transacciones en dominio;
- backend recalcula;
- frontend no es fuente de verdad;
- idempotencia;
- concurrencia/versionado;
- efectos después del commit;
- errores estables;
- autorización backend.

## Paso 7 · Compatibilidad visible

- conservar etiquetas/puntos de entrada válidos;
- adaptar PC y móvil;
- no exponer Payments/Printing como módulos;
- Caja en header;
- Impresoras futura en Configuración;
- actualizar caché PWA cuando aplique.

## Paso 8 · Pruebas

Cobertura mínima:

- caso correcto;
- validaciones;
- autorización;
- rollback;
- idempotencia;
- concurrencia;
- legacy;
- lectura sin efectos;
- integridad financiera/operativa;
- UI PC/móvil cuando aplique.

Comandos base:

```powershell
npm ci
npm run test:sqlite-driver
npm test
npm audit --omit=dev
```

## Paso 9 · Sintaxis y arranque

```powershell
node --check <archivo>
npm start
```

Validar HTTPS local e IP de red.

## Paso 10 · Documentación

Actualizar cuando corresponda:

```text
README.md
docs/README-v3.0.md
docs/roadmap-v3.0-arquitectura-modular.md
docs/avance-vX.Y.Z-....md
package.json
server/config/appInfo.js
public/index.html
public/service-worker.js
```

## Paso 11 · ZIP autocontenido y mínimo

El ZIP de entrega debe contener únicamente archivos creados o modificados para la fase, preservando rutas desde la raíz.

Nunca incluir:

```text
.git
.env
certs
*.pem
*.key
node_modules
data/*.db
data/*.sqlite
data/*.db-shm
data/*.db-wal
data/backups
respaldos
cookies
archivos temporales
```

No uses `git archive` ciegamente mientras existan respaldos rastreados. Verifica el contenido real del ZIP antes de ofrecerlo.

## Paso 12 · Git seguro

Nunca:

```powershell
git add .
git add -A
git commit -a
git clean
git reset --hard
```

Antes de commit:

```powershell
Stop-Process -Name node -Force -ErrorAction SilentlyContinue
git status --short
git diff --cached --name-only
git diff --cached --check
```

Filtro:

```powershell
git diff --cached --name-only |
Select-String -Pattern "\.env$|certs/|cookies\.txt|data/.*\.db|data/.*\.sqlite|data/.*\.db-shm|data/.*\.db-wal|data/backups|mundipos-rootCA|\.pem$|\.key$|node_modules"
```

Debe quedar vacío.

Agrega archivos explícitos. No publiques hasta que el usuario confirme validación operativa y Git.

## Paso 13 · Confirmación

Después de entregar una fase, espera confirmación operativa y Git antes de avanzar.

---

# 13. Verificación inicial recomendada en el nuevo chat

Solicita o ejecuta en bloques controlados:

```powershell
Set-Location C:\Repos\POS_Restaurante

git status --short
git branch --show-current
git branch -vv
git rev-list --left-right --count origin/main...main
git log -8 --oneline --decorate --graph
git stash list
```

Luego:

```powershell
git show --stat --summary a39555a
git show --name-status --format=fuller a39555a
git diff d5edf05..a39555a --
```

Luego:

```powershell
node -v
npm -v
node -p "require('./package.json').version"
node -p "require('./package.json').dependencies.sqlite3"
node -p "require('./package.json').engines.node"
npm ls sqlite3 --depth=0
```

Bases y seguridad:

```powershell
git ls-files -- data/restaurant.db
git check-ignore -v data/restaurant.db
git ls-files -- data/backups
git ls-files -- .vscode/settings.json
```

Pruebas:

```powershell
npm run test:sqlite-driver
npm test
npm audit --omit=dev
```

No pidas todos los bloques a la vez si el usuario está trabajando de forma interactiva. El patrón acordado es un bloque de PowerShell por turno y revisión de salida antes del siguiente.

---

# 14. Estado implementado para validación · v3.3.0 Dominio Kitchen / Comandas

La implementación candidata se documenta en:

```text
docs/auditoria-v3.3.0-kitchen-comandas.md
docs/avance-v3.3.0-kitchen-comandas.md
```

Incluye `kitchenService`, modelo normalizado, destinos Cocina/Bar, deltas por línea, snapshots, usuario solicitante, idempotencia, concurrencia, realtime y adaptadores legacy. Aún requiere aplicación sobre el repositorio local, suite con `sqlite3@6.0.1`, pruebas manuales y publicación Git antes de iniciar `v3.3.1`.


## Objetivo

Separar de Orders la lógica de preparación y establecer Kitchen como propietario del contenido y estado operativo de comandas.

```text
Orders registra consumo y solicita envío.
Kitchen calcula cambios no enviados y crea comandas.
Printing imprime posteriormente, pero no decide contenido ni preparación.
```

## Auditoría completada

La auditoría publicada localizó y documentó:

- tabla `comandas` y relacionadas;
- almacenamiento actual de ítems, texto o JSON;
- relación con `pedidos`, `pedido_productos` o equivalentes;
- columnas mezclando impresión/preparación;
- rutas de creación, pendientes, envío, reenvío y actualización;
- llamadas desde Orders;
- placeholders de impresión;
- productos que requieren cocina/bar;
- destino por categoría, subcategoría, producto o presentación;
- cantidades enviadas, pendientes y anuladas;
- modificaciones/anulaciones posteriores;
- realtime;
- capacidad `kitchen.operate`;
- UI actual;
- comportamiento tras reinicio;
- condiciones de carrera en dos dispositivos.

La auditoría fue publicada antes de la implementación y debe conservarse como contrato técnico de la fase.

## Alcance implementado

El código real incorpora el servicio de dominio:

```text
server/services/kitchenService.js
```

Responsabilidades:

- crear comandas desde cambios no enviados;
- identificar líneas por identidad estable y cantidad;
- no reenviar unidades ya comandadas;
- incluir solo productos con preparación;
- resolver destino cocina/bar canónicamente;
- conservar snapshots de producto/presentación/observaciones;
- registrar solicitante, responsable y timestamps;
- soportar adiciones posteriores;
- representar ajustes/anulaciones sin borrar historia;
- mantener idempotencia y concurrencia;
- publicar realtime después del commit.

## Modelo implementado

La migración idempotente conserva los conceptos:

```text
comandas
- id
- pedido_id / cuenta_global_id
- numero_comanda
- destino
- estado_operativo
- usuario_solicitante
- responsable
- timestamps
- version

comanda_items
- comanda_id
- pedido_producto_id / linea_consumo_id
- cantidad
- producto_snapshot
- presentacion_snapshot
- observacion
- tipo_cambio: alta | ajuste | anulacion
- estado_operativo

historial_comandas
- entidad
- accion
- estado_anterior
- estado_nuevo
- usuario
- fecha
- metadata
```

Los nombres finales y su compatibilidad están documentados en `docs/avance-v3.3.0-kitchen-comandas.md`.

## Casos cubiertos y pendientes de validación nativa

1. `Hamburguesa ×2`: envía exactamente dos unidades.
2. Repetir envío sin cambios: no crea duplicado.
3. Agregar una unidad: envía solo la nueva.
4. Producto sin preparación: queda fuera.
5. Presentación: conserva descripción exacta.
6. Cocina/bar: separa destinos.
7. Modificación/anulación: conserva historia.
8. Dos dispositivos: no duplican cantidades.
9. Falla futura de impresión: comanda operativa persiste.
10. Reinicio: pendientes recuperables.
11. Sin `kitchen.operate`: operación rechazada en backend.
12. Realtime: filtrado por autorización y destino/zona.

## No alcance

No implementar todavía:

- cola definitiva de Printing;
- drivers térmicos;
- configuración de impresoras;
- todos los estados avanzados de `v3.3.1`;
- reportes finales de Kitchen;
- limpieza completa de legacy.

## Criterios de aprobación

- Orders no decide directamente el contenido de la comanda;
- Kitchen genera solo cambios nuevos;
- reintentos no duplican;
- productos sin preparación quedan fuera;
- destinos correctos;
- historial preservado;
- impresión desacoplada;
- pruebas específicas y suite completa pasan;
- operación actual no se rompe;
- documentación y Git completos.

Commit canónico sugerido:

```powershell
git commit -m "v3.3.0: separa dominio de Kitchen y comandas"
```

No prepares este commit hasta que la higiene Git esté cerrada y el usuario confirme la validación funcional.

---

# 15. Fases posteriores

```text
v3.3.1 · Trazabilidad operativa de comandas
v3.4.0 · Núcleo y cola de Printing
v3.4.1 · Integración transversal de documentos
v3.4.2 · Configuración → Impresoras
v3.5.0 · Dashboard y reportes financieros consolidados
v3.5.1 · Realtime y recuperación operativa
v3.6.0 · Limpieza legacy y orden estructural
v3.7.0 · Pruebas cruzadas y cierre MundiPOS 3.0
```

No adelantes fases.

Estados previstos para `v3.3.1`:

```text
pendiente
enviada
en_preparacion
lista
entregada
anulada
```

Printing debe ser posterior al commit de negocio y no controlar el estado de preparación.

Dashboard debe mantener una venta global y movimientos individuales de Caja sin doble contabilización.

---

# 16. Restricciones absolutas

No debes:

1. Reescribir el proyecto desde cero.
2. Combinar ZIP antiguos para reconstruir una nueva base de código.
3. Trabajar sin inspeccionar el ZIP/HEAD más reciente.
4. Ignorar el commit `a39555a`.
5. Considerar resuelto el rastreo de respaldos SQLite sin verificarlo.
6. Exponer contenido de bases en el chat.
7. Reescribir historial o force-push sin aprobación.
8. Convertir prefacturas en ventas independientes.
9. Cerrar mesa por pago o saldo cero.
10. Liberar mesa desde Payments.
11. Cobrar desde Dashboard.
12. Mover división de cuenta a Caja.
13. Preparar varias subcuentas simultáneamente.
14. Reutilizar cantidades documentadas.
15. Confiar en montos del frontend.
16. Autorizar solo ocultando botones.
17. Emitir realtime antes del commit.
18. Imprimir antes de persistir.
19. Mezclar impresión con preparación.
20. Eliminar historial financiero u operativo.
21. Eliminar tablas legacy antes de migrar consumidores.
22. Ejecutar `npm audit fix --force`.
23. Incluir bases, certificados, secretos o `node_modules` en ZIP/Git.
24. Usar `git add .`, `git add -A` o `git commit -a`.
25. Usar `git clean` o `git reset --hard`.
26. Aplicar o eliminar el stash automáticamente.
27. Borrar `.git` u objetos Git.
28. Volver a desarrollar dentro de OneDrive.
29. Cambiar HTTPS a HTTP para resolver PWA.
30. Cambiar puerto/IP sin evaluar certificados y origen PWA.
31. Afirmar pruebas no ejecutadas.
32. Ofrecer un ZIP sin crearlo e inspeccionarlo.
33. Avanzar de fase sin confirmación operativa y Git.
34. Inventar rutas, tablas o archivos.
35. Ejecutar scripts antiguos de recuperación SQLite.
36. Copiar `RECOVERY_KEEP_20260717.zip` dentro del proyecto.

---

# 17. Formato esperado de entregas

Para una implementación, responder en este orden:

1. nombre exacto de la fase;
2. enlace al ZIP mínimo creado;
3. objetivo y reglas preservadas;
4. cambios backend;
5. cambios frontend;
6. migración de base;
7. capacidades/autorización;
8. realtime;
9. compatibilidad y no alcance;
10. pruebas realmente ejecutadas;
11. pruebas locales del usuario;
12. validación operativa paso a paso;
13. lista de archivos incluidos;
14. comandos `git add` explícitos;
15. filtro de seguridad;
16. commit canónico;
17. próxima fase.

Distingue siempre:

```text
validado en entorno de construcción
pendiente de validar en Windows
confirmado operativamente por el usuario
```

Cuando el usuario trabaje en consola, entrega un bloque de PowerShell por turno. No satures con múltiples acciones irreversibles simultáneas.

---

# 18. Creación segura del ZIP para el nuevo chat

No uses el ZIP antiguo de este chat como fuente final. El nuevo chat necesita un ZIP del `HEAD` actual después de verificar el commit `a39555a` y resolver la higiene de respaldos rastreados.

Cuando Git esté limpio y los respaldos ya no estén en el árbol actual, puede usarse:

```powershell
Set-Location C:\Repos\POS_Restaurante

git status --short
git log -1 --oneline --decorate

git archive `
  --format=zip `
  --output="C:\Repos\POS_Restaurante_HEAD_ACTUAL.zip" `
  HEAD
```

Antes de adjuntarlo, inspecciona sus entradas y confirma que no contenga:

```text
data/*.db
data/backups/
.env
certs/
*.pem
*.key
node_modules/
.git/
```

Adjuntar al nuevo chat:

```text
docs/PROMPT-CONTINUIDAD-MUNDIPOS-3.0.md
POS_Restaurante_HEAD_ACTUAL.zip
```

---

# 19. Primera respuesta esperada del nuevo chat

La primera respuesta debe demostrar comprensión y no comenzar a programar. Debe expresar esencialmente:

```text
1. Confirmaré el HEAD real, main/origin y el árbol limpio.
2. Auditaré el commit a39555a antes de asumir equivalencia funcional.
3. Leeré documentos canónicos y el README de recuperación.
4. Verificaré versión, SQLite, base ignorada, HTTPS/PWA y pruebas.
5. Resolveré primero los respaldos SQLite rastreados sin borrar copias locales ni reescribir historial automáticamente.
6. Después auditaré Kitchen/Comandas en el código vigente.
7. No alteraré cuenta global, Caja, Payments, créditos, división ni finalización.
8. No generaré código hasta presentar alcance, migración, riesgos y pruebas de v3.3.0.
```

Después debe trabajar con evidencia real del ZIP y de la salida del usuario.


---

# 20. Hotfix posterior a v3.3.0 · fix1 de inicialización Kitchen

Después de publicar `v3.3.0`, el arranque sobre la base operativa real procedente de `v3.2.5` expuso dos fallos encadenados de migración.

Primer error:

```text
SQLITE_ERROR: no such column: pedido_id
CREATE INDEX IF NOT EXISTS idx_comandas_pedido ON comandas(pedido_id)
```

Causa: `createIndexes()` se ejecutaba antes de `migrateSchema()`, cuando `comandas` todavía conservaba el esquema legacy.

Segundo error, visible después de corregir el orden:

```text
SQLITE_CONSTRAINT: NOT NULL constraint failed: comandas_new.solicitada_en
```

Causa: `ensureKitchenSchema()` agrega `solicitada_en` como `TEXT` nullable para mantener compatibilidad con `ALTER TABLE`. Las filas legacy existentes quedan temporalmente con `NULL`. Durante `rebuildLegacyForeignKeys()`, la copia explícita de ese `NULL` hacia `comandas_new.solicitada_en NOT NULL` no utiliza el default de la tabla nueva.

Corrección canónica `v3.3.0 fix1`:

```text
createTables
→ migrateSchema
  → ensureKitchenSchema
  → normalizar campos obligatorios de comandas legacy
  → rebuildLegacyForeignKeys
→ createIndexes
```

Para `solicitada_en`, la normalización usa en este orden:

```text
solicitada_en existente
→ fecha_impresion legacy
→ CURRENT_TIMESTAMP como último fallback
```

No se debe eliminar, reemplazar ni reconstruir manualmente `data/restaurant.db`. La migración debe conservar el historial y ser idempotente incluso después de un intento de arranque parcialmente fallido.

Documento:

```text
docs/avance-v3.3.0-fix1-inicializacion-kitchen.md
```

Commit esperado:

```text
v3.3.0 fix1: corrige inicializacion de Kitchen sobre base legacy
```

`v3.3.1` no debe comenzar hasta que este fix arranque correctamente sobre la base operativa, la suite completa pase y Git quede publicado de forma segura.


---

# 21. Estado implementado para validación · v3.3.1 Trazabilidad operativa de comandas

`v3.3.1` amplía el dominio Kitchen sin adelantar la cuenta departamental ni la UI completa de `v3.3.2`.

Contratos implementados:

```text
pendiente → enviada → en_preparacion → lista → entregada
cualquier estado no terminal permitido → anulada con motivo
Printing ≠ estado operativo
```

Cada cambio de estado usa versión esperada, actor operativo y timestamp. Las comandas conservan `enviada_en`, `preparacion_iniciada_en`, `lista_en`, `entregada_en`, `anulada_en` y `actualizada_en`.

Se incorpora `historial_comanda_items` para registrar antes/después de envíos, ajustes, anulaciones y reenvíos. El read model `/api/kitchen/board` se reconstruye exclusivamente desde SQLite y no depende de memoria del proceso.

Rutas nuevas:

```text
GET /api/kitchen/board
GET /api/kitchen/comandas/:id/history
PUT /api/kitchen/comandas/:id/state
```

Realtime conserva capacidad y zona y soporta destino `cocina`/`bar` cuando la sesión define `kitchenDestinations`.

Documento:

```text
docs/avance-v3.3.1-trazabilidad-comandas.md
```

La siguiente fase, únicamente después de pruebas, validación operativa y Git seguro, es:

```text
v3.3.2 · Cuenta departamental y UI/UX de Kitchen
```


# 22. Estado implementado para validación · v3.3.2 Cuenta departamental y UI/UX de Kitchen

`v3.3.2` agrega la cuenta departamental de Cocina y el tablero visual operativo sin adelantar el dominio Printing.

Contratos añadidos:

- una cuenta departamental no representa a una persona ni puede asumir responsabilidad financiera o de mesa;
- la cuenta `Cocina` se provisiona idempotentemente, queda inactiva hasta que un administrador defina una contraseña y la active, y no expone credenciales predeterminadas;
- su único rol es el rol de sistema `Cocina`, sin zona obligatoria y con la única capacidad `kitchen.operate`;
- su navegación inicial y exclusiva es `Kitchen`;
- el solicitante humano original permanece inmutable en la comanda;
- las acciones de estado se auditan con la identidad de la estación departamental;
- el tablero visual es persistente e independiente de Printing.

El tablero muestra hora, tiempo transcurrido, mesa/banco, zona, solicitante humano, producto, cantidad, presentación, adicionales, observaciones, destino y tipo de cambio. Realtime actualiza la vista activa y muestra el estado de reconexión; un refresco periódico sirve únicamente como recuperación.

Archivos centrales:

```text
server/db/database.js
server/routes/auth.js
server/routes/users.js
server/services/operationalAccessService.js
public/js/services/operational-access.js
public/js/components/kitchen.js
public/js/components/users.js
public/js/main.js
public/css/style.css
public/index.html
```

Documento de avance: `docs/avance-v3.3.2-cuenta-departamental-ui-kitchen.md`.

La siguiente fase es `v3.4.0 · Núcleo y cola de Printing` únicamente después de pruebas específicas, suite completa, validación operativa y Git seguro de `v3.3.2`.

# 23. Estado implementado para validación · v3.4.0 Núcleo y cola de Printing

`v3.4.0` crea el servicio transversal Printing sin integrar todavía los documentos específicos de Orders, Caja, Créditos o Kitchen.

Contratos añadidos:

- `trabajos_impresion` persiste cada copia antes de ejecutar un adaptador;
- `intentos_impresion` conserva cada ejecución, error y resultado;
- `plantillas_documento` versiona contenido reutilizable;
- la identidad idempotente es `documento_tipo + documento_id + copia`;
- el payload canónico se guarda con fingerprint y no puede cambiar para la misma identidad;
- un fallo de adaptador deja el trabajo fallido sin revertir el documento de negocio;
- los reintentos reutilizan el mismo trabajo y respetan `max_intentos`;
- trabajos abandonados en `procesando` se recuperan al iniciar el servidor;
- el adaptador inicial `navegador_pdf` produce vista previa HTML y deja preparada la extensión a drivers térmicos.

Rutas internas:

```text
GET  /api/printing/jobs
GET  /api/printing/jobs/:id
POST /api/printing/jobs/:id/process
POST /api/printing/jobs/:id/retry
POST /api/printing/preview
PUT  /api/printing/templates/:code
```

Documento de avance: `docs/avance-v3.4.0-printing-core-queue.md`.

La siguiente fase es `v3.4.1 · Integración transversal de documentos` únicamente después de pruebas específicas, suite completa, validación operativa y Git seguro de `v3.4.0`.

# 24. Estado implementado para validación · v3.4.1 Integración transversal de documentos

`v3.4.1` conecta los documentos de negocio al núcleo de Printing de `v3.4.0` mediante `documentPrintingService`.

Contratos añadidos:

- los dominios persisten primero y encolan después;
- prefacturas completas y parciales conservan su `numero_documento`;
- pagos de prefactura generan recibos de cobro usando el registro persistido de `pagos`;
- formalizaciones de crédito generan comprobantes de crédito;
- cobros posteriores de crédito generan documentos de abono;
- comandas de cocina/bar se encolan desde su snapshot persistido;
- el cierre diario usa el resumen ya calculado por `FinancialReadService`;
- `enqueueNextCopy()` reserva la siguiente copia sin cambiar el número documental;
- cada copia se audita como trabajo independiente y cada reintento técnico permanece dentro de ese trabajo;
- una falla de Printing no revierte la operación financiera u operativa ya persistida;
- Orders, Caja, Créditos y Kitchen no contienen plantillas de documento duplicadas.

Rutas/documentos relevantes:

```text
POST /api/printing/documents/daily-close
POST /api/cash/preinvoices/:preinvoiceId/reprint-request
POST /api/cash/payments/:paymentId/reprint-request
POST /api/cash/credits/:creditId/reprint-request
```

Documento de avance: `docs/avance-v3.4.1-integracion-documentos-printing.md`.

`v3.4.2 · Configuración → Impresoras` fue implementada después de autorización explícita. Las pruebas operativas, suite completa y Git de las fases entregadas pueden ejecutarse posteriormente, fase por fase y en orden, según la dinámica temporal indicada por el usuario.



# 25. Estado implementado para validación · v3.4.2 Configuración → Impresoras

`v3.4.2` agrega la configuración central de impresoras dentro de Settings y mantiene Printing como servicio interno transversal.

Contratos añadidos:

- Caja, Cocina y Bar tienen configuración independiente;
- Settings guarda dispositivo, adaptador, papel, copias físicas, autoimpresión, plantilla y estado activo;
- Printing resuelve esa configuración al crear el trabajo y guarda un snapshot inmutable;
- una modificación posterior en Settings no cambia trabajos ya encolados;
- una repetición idempotente de la misma copia conserva el trabajo original aunque la impresora haya cambiado;
- prefacturas, recibos, créditos, abonos y cierres diarios se enrutan a Caja;
- comandas se enrutan a Cocina o Bar según `payload.destino`;
- la prueba de impresión es técnica y no crea ni modifica documentos de negocio;
- el estado del dispositivo registra última prueba y error conocido;
- la pestaña Impresoras vive dentro de Configuración y Printing no aparece como módulo principal.

Rutas relevantes:

```text
GET  /api/settings/printers
PUT  /api/settings/printers/:destination
GET  /api/printing/printers/status
POST /api/printing/printers/:destination/test
GET  /api/printing/templates
```

Documento de avance: `docs/avance-v3.4.2-configuracion-impresoras.md`.

Dinámica temporal acordada: las verificaciones finales y Git de `v3.4.0`, `v3.4.1` y `v3.4.2` se realizarán posteriormente, en orden y fase por fase. La siguiente fase de código es `v3.5.0 · Dashboard y reportes financieros consolidados` únicamente cuando el usuario confirme explícitamente que continúe.
