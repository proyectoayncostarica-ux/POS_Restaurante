# Prompt de continuidad · MundiPOS 3.0

> **Uso:** adjunta este archivo al nuevo chat junto con un ZIP actualizado del repositorio y pega el bloque **“Prompt listo para usar”** como primer mensaje. Este documento es el traspaso canónico del trabajo realizado y evita reconstrucciones, suposiciones o desviaciones.

---

# Prompt listo para usar

Estás continuando el desarrollo del proyecto **MundiPOS / POS Restaurante**. Debes trabajar de forma incremental, auditable y compatible con la operación real de restaurantes y bares.

Antes de proponer o modificar código:

1. Lee por completo este archivo.
2. Inspecciona el ZIP más reciente del repositorio que adjuntaré.
3. Dentro del repositorio, lee primero los documentos canónicos indicados en la sección **Documentos obligatorios**.
4. Verifica el estado real con `package.json`, `git log`, `git status`, pruebas y código actual. No supongas que una fase está aplicada solo porque aparece descrita aquí.
5. Si no se adjuntó un ZIP actualizado del repositorio, solicítalo antes de crear una implementación. No reconstruyas el proyecto combinando ZIP antiguos.
6. La próxima fase funcional prevista es `v3.3.0 · Dominio Kitchen / Comandas`, pero antes debes confirmar que `v3.2.5 · Finalización del servicio y liberación integral` fue aplicada, probada, confirmada operativamente y comprometida en Git.

Trabaja con las reglas, contratos de negocio, arquitectura, restricciones, validaciones y formato de entrega establecidos en este documento. No alteres el flujo acordado, no adelantes fases y no sustituyas la fuente financiera global por documentos parciales.

---

# 1. Identidad y propósito del proyecto

**Proyecto:** MundiPOS / POS Restaurante  
**Stack:** Node.js, Express, SQLite, frontend JavaScript vanilla y PWA.  
**Repositorio local vigente del usuario:**

```text
C:\Repos\POS_Restaurante
```

El repositorio fue movido fuera de OneDrive porque OneDrive bloqueaba `.git/objects` durante los commits. La copia anterior fue renombrada como respaldo y no debe utilizarse para desarrollar:

```text
C:\Users\andre\OneDrive\Documentos\Proyecto\POSRestaurante\POS_Restaurante_RESPALDO_NO_USAR
```

**Objetivo de MundiPOS 3.0:** modularizar la arquitectura y representar correctamente el flujo real de atención, división de cuentas, prefacturas, Caja, pagos, créditos, comandas, impresión, reportes y cierre de mesas sin provocar una ruptura innecesaria de la experiencia visible.

---

# 2. Estado exacto de continuidad

## 2.1 Último estado confirmado antes del traspaso

Las fases hasta `v3.2.4 · Créditos integrados con Payments` fueron reportadas por el usuario como funcionales antes de solicitar continuar.

La implementación de:

```text
v3.2.5 · Finalización del servicio y liberación integral
```

fue entregada en el chat anterior mediante:

```text
v3.2.5-finalizacion-servicio.zip
```

pero el usuario todavía **no confirmó explícitamente** en el chat anterior que:

- la extrajo sobre el repositorio;
- ejecutó las pruebas;
- la validó operativamente;
- realizó commit y push.

Por tanto, el nuevo chat debe iniciar verificando `v3.2.5` y no asumir que ya está cerrada.

## 2.2 Verificación inicial obligatoria

Solicita al usuario ejecutar o proporcionar:

```powershell
Set-Location C:\Repos\POS_Restaurante

git status --short
git log -5 --oneline
node -v
npm -v
npm ls sqlite3 --depth=0
npm test
```

Revisa además:

```powershell
Select-String -Path .\package.json -Pattern '"version"'
Test-Path .\server\services\serviceFinalizationService.js
Test-Path .\docs\avance-v3.2.5-finalizacion-servicio.md
```

La fase `v3.2.5` solo puede marcarse cerrada cuando exista el commit esperado o uno equivalente, las pruebas pasen y el usuario confirme la operación.

Commit canónico de esa fase:

```powershell
git commit -m "v3.2.5: finaliza servicio y libera mesas integralmente"
```

## 2.3 Próxima fase después de cerrar v3.2.5

```text
v3.3.0 · Dominio Kitchen / Comandas
```

No avances a `v3.3.1`, Printing o reportes hasta cerrar y validar `v3.3.0`.

---

# 3. Documentos obligatorios que debes leer

Dentro del ZIP/repositorio actualizado, localiza y lee en este orden:

```text
README.md
docs/README-v3.0.md
docs/roadmap-v3.0-arquitectura-modular.md

docs/contrato-v3.0-compatibilidad-ui.md
docs/contrato-v3.0-operacion-caja-prefacturas.md
docs/contrato-v3.0-cuenta-global-fuente-financiera.md

docs/auditoria-v3.0.0-arquitectura-modular.md
docs/auditoria-v3.0.0-fix1-caja-prefacturas-subcuentas.md
```

Luego lee los avances existentes, especialmente:

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
docs/avance-v3.2.1-api-read-model-caja.md
docs/avance-v3.2.2-caja-visual-modal-cobro.md
docs/avance-v3.2.3-medios-pago.md
docs/avance-v3.2.4-creditos-payments.md
docs/avance-v3.2.5-finalizacion-servicio.md
```

Algunos nombres pueden variar ligeramente. Usa el contenido y el roadmap para resolverlos. No inventes archivos faltantes ni afirmes haberlos leído si no están dentro del material adjunto.

También inspecciona directamente:

```text
package.json
package-lock.json
server/config/appInfo.js
server/db/database.js
server/app.js

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

server/routes/orders.js
server/routes/cash.js
server/routes/accounts.js
server/routes/credits.js
server/routes/dashboard.js
server/utils/realtime.js

public/js/components/orders.js
public/js/components/cash.js
public/js/components/accounts.js
public/js/components/dashboard.js
public/service-worker.js
public/index.html
```

Para Kitchen, debes auditar el código actual relacionado con:

```text
comandas
cocina
bar
preparación
envío o reenvío
anulación de productos
Orders.printComanda o placeholders equivalentes
estado de impresión mezclado con estado operativo
```

No reutilices hallazgos antiguos sin verificar que todavía existan en el código vigente.

---

# 4. Contrato de negocio inmutable

Estas reglas fueron acordadas con el usuario y no pueden cambiarse sin una conversación explícita.

## 4.1 Cuenta global como única fuente financiera

La cuenta global de la mesa o banco es la única venta financiera real.

```text
Cuenta global
├── cliente principal
├── mesa/banco
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

Contablemente significa:

```text
1 venta global de ₡5.000
2 documentos operativos
2 movimientos de Caja que suman ₡5.000
```

Nunca deben registrarse dos ventas independientes de ₡3.000 y ₡2.000.

Los pagadores parciales no reemplazan:

- al cliente principal;
- al responsable de atención;
- a la mesa o banco;
- a la zona;
- al número de cuenta global.

## 4.2 División una subcuenta a la vez

La división la realiza el mesero, salonero o bartender en `Ver pedido`.

Flujo obligatorio:

1. Activar `Cuenta dividida`.
2. Seleccionar ítems de un solo cliente mediante checkboxes.
3. Cuando una línea tenga cantidad mayor a uno, elegir la cantidad para ese cliente.
4. Revisar el subtotal/servicio/total parcial.
5. Pulsar `Emitir prefactura`.
6. Abrir un minimodal.
7. Escribir el nombre del cliente/pagador.
8. Mostrar ítems, cantidades y total.
9. Permitir `Volver` sin escribir en la base ni consumir numeración.
10. Confirmar `Imprimir y emitir`.
11. Persistir una sola prefactura.
12. Volver al consumo restante y repetir para el siguiente cliente.

No se preparan dos prefacturas simultáneamente.

Regla de cantidad:

```text
cantidad_disponible
= cantidad_consumida
- cantidad_asignada_a_prefacturas_activas
```

Una misma unidad no puede pertenecer a dos prefacturas válidas.

## 4.3 Continuidad después de un pago

Pagar una prefactura no cierra la mesa.

Ejemplo:

```text
Juan paga y se retira.
Los demás clientes continúan consumiendo.
```

El sistema debe:

- ocultar del consumo activo las cantidades ya documentadas/pagadas;
- conservarlas en el historial;
- mantener la cuenta global abierta;
- mantener mesa, cliente principal y responsables;
- permitir agregar productos nuevos;
- generar saldo nuevo solamente por el consumo posterior.

La cuenta puede estar temporalmente en:

```text
estado_operativo = abierta
estado_financiero = conciliada
saldo = 0
```

## 4.4 Cierre explícito del servicio

Saldo cero no significa mesa libre.

La liberación ocurre solamente cuando el responsable pulsa:

```text
Finalizar servicio
```

El backend debe validar, de forma transaccional, que no existan:

- consumos disponibles sin prefacturar;
- cantidades reservadas sin documento;
- prefacturas emitidas o parciales;
- pagos pendientes;
- saldo global pendiente;
- créditos incompletos o no formalizados;
- conflicto de versión o concurrencia.

Un crédito formalizado puede permitir liberar la mesa, aunque la deuda continúe en cartera.

## 4.5 Separación de responsabilidades

```text
Orders / Cuentas
- atención;
- cuenta global;
- consumo;
- productos y cantidades;
- envío de solicitudes a Kitchen;
- emisión de prefacturas;
- finalización del servicio.

Caja
- interfaz visible del cajero;
- búsqueda de prefacturas;
- cobro;
- efectivo, vuelto, tarjeta, mixtos;
- reimpresión autorizada;
- formalización de crédito.

Payments
- servicio interno;
- idempotencia;
- transacciones monetarias;
- pagos y reversos;
- componentes de pago;
- saldos por prefactura;
- consolidación en cuenta global;
- nunca libera la mesa por sí solo.

Kitchen
- preparación;
- contenido y estado operativo de comandas;
- destinos cocina/bar;
- cambios y anulaciones;
- tiempos y responsables.

Printing
- servicio interno;
- plantillas;
- trabajos persistentes;
- intentos, errores y reintentos;
- dispositivos;
- no decide reglas de negocio de Orders, Payments o Kitchen.

Settings
- pestaña Impresoras;
- configuración de dispositivos y plantillas.
```

Payments y Printing no deben aparecer como módulos técnicos en la navegación. Caja sí es visible desde el header para usuarios autorizados.

## 4.6 Roles y capacidades

`usuarios.tipo` permanece limitado a conceptos generales como básico/administrador. Cajero es un rol o capacidad operativa, no un tercer tipo rígido.

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

El backend autoriza. Ocultar botones no es seguridad suficiente.

## 4.7 Impresión

Regla obligatoria:

```text
persistir documento
→ confirmar transacción de negocio
→ crear/solicitar trabajo de impresión
→ intentar imprimir
```

Una falla de impresión:

- no revierte un pago confirmado;
- no duplica una prefactura;
- no consume otro número documental;
- debe ser reintentable y auditable.

---

# 5. Arquitectura ya implementada

Las siguientes bases se consideran parte del diseño aprobado; verifica su existencia y funcionamiento en el código actual antes de usarlas.

## 5.1 Infraestructura

- transacciones SQLite reutilizables;
- `BEGIN IMMEDIATE` para mutaciones críticas;
- savepoints;
- callbacks posteriores a commit/rollback;
- errores de dominio con códigos estables;
- utilidades monetarias;
- idempotencia;
- pruebas con SQLite temporal;
- control de concurrencia.

## 5.2 Acceso operativo

- capacidades persistentes;
- rol Cajero sin zona obligatoria;
- navegación autorizada;
- destino inicial Caja;
- acceso compartido por múltiples roles activos;
- filtros por zona y responsabilidad;
- realtime filtrado por capacidades y alcance.

## 5.3 Cuenta global y documentos

- cuenta global persistente;
- número `CTA-########`;
- estados operativo y financiero separados;
- snapshots de cliente, mesa, zona y responsables;
- líneas de consumo con identidad estable;
- cantidades consumidas, asignadas y disponibles;
- snapshots de producto, presentación, precio y servicio;
- prefacturas `PF-########`;
- ítems persistentes;
- historial;
- anulación interna;
- emisión idempotente.

## 5.4 Caja y Payments

- pagos `PG-########`;
- pagos parciales/completos por prefactura;
- efectivo, vuelto, tarjeta y mixtos;
- tabla de medios de pago;
- reversos auditables;
- API y read model de Caja;
- UI de Caja y modal de cobro;
- movimientos de Caja separados de ventas globales.

## 5.5 Créditos

- créditos `CR-########`;
- formalización desde una prefactura;
- autorización administrativa;
- pago de apertura con naturaleza de liquidación de venta;
- abonos posteriores como cobro de crédito;
- cartera e historial;
- sin doble contabilización de la venta.

## 5.6 Finalización

La fase `v3.2.5` introduce o debe introducir:

```text
server/services/serviceFinalizationService.js
GET  /api/orders/:id/finalization
POST /api/orders/:id/finalize-service
```

Debe cerrar cuenta y liberar mesa de forma atómica, conservando todo el historial.

---

# 6. Historial de fases

## Menú v2.2.5M completado

El módulo Menú fue normalizado antes de iniciar MundiPOS 3.0:

- productos operativos;
- presentaciones y precios;
- estados activo/inactivo;
- protección administrativa;
- tipos y grupos de presentación;
- normalización visual;
- integración Menu → Orders;
- pruebas y limpieza legacy;
- generación/importación de plantillas Excel;
- imágenes por presentación.

No reviertas ni rediseñes este contrato salvo que una fase futura detecte un defecto comprobado.

## MundiPOS 3.0 completado o entregado

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
v3.2.0 fix2  Driver sqlite3 actualizado de forma controlada
v3.2.1       API y read model de Caja
v3.2.2       Caja visual y modal de cobro
v3.2.3       Efectivo, vuelto, tarjeta y mixtos
v3.2.4       Créditos integrados con Payments
v3.2.5       Finalización y liberación integral — verificar cierre
```

---

# 7. Entorno local y restricciones de infraestructura

## 7.1 Node y SQLite

Último entorno reportado por el usuario:

```text
Node.js v24.16.0
```

La actualización controlada tenía como objetivo:

```text
sqlite3@6.0.1
Node >= 20.17.0
```

No asumas el resultado: verifica con:

```powershell
npm ls sqlite3 --depth=0
npm run test:sqlite-driver
npm audit --omit=dev
```

No ejecutes automáticamente:

```powershell
npm audit fix --force
```

Cualquier actualización mayor debe tratarse como una subfase controlada, con lockfile reproducible, `npm ci`, pruebas y rollback.

## 7.2 HTTPS y PWA

La aplicación debe funcionar por HTTPS tanto en localhost como en la IP local para permitir PWA móvil.

IP local acordada:

```text
192.168.0.2
```

URLs esperadas:

```text
https://localhost:3000/POS/
https://192.168.0.2:3000/POS/
```

Los certificados son locales y están ignorados por Git:

```text
.env
certs/
*.pem
*.key
public/mundipos-rootCA.crt
```

No los sobrescribas, elimines, empaquetes ni solicites su contenido privado. Los ZIP de implementación no deben contenerlos.

Cada cambio de `public/service-worker.js` o assets frontend relevantes debe actualizar el nombre del caché PWA para evitar que móviles conserven código antiguo.

## 7.3 Puerto 3000

Si aparece `EADDRINUSE`, identifica y detén la instancia anterior. No cambies el puerto por conveniencia sin revisar certificados, PWA, configuración y documentación.

## 7.4 Base operativa

La base local es:

```text
data/restaurant.db
```

Debe estar ignorada y no rastreada por Git. Antes de migraciones importantes se crea un respaldo local en:

```text
data/backups/
```

Nunca incluyas en un ZIP o commit:

```text
data/*.db
data/*.sqlite
data/*.db-shm
data/*.db-wal
data/backups/
```

Al inicio del nuevo chat verifica:

```powershell
git ls-files -- data/restaurant.db
git check-ignore -v data/restaurant.db
git status --short
```

`git ls-files` no debe listar la base. Si la lista, detén el desarrollo y corrige el seguimiento sin borrar el archivo local.

---

# 8. Repositorio, Git y seguridad

## 8.1 No usar OneDrive para el repositorio activo

El código activo está en:

```text
C:\Repos\POS_Restaurante
```

No regreses `.git` a OneDrive. GitHub es el respaldo del código.

## 8.2 Mantenimiento Git

En el antiguo repositorio se deshabilitó el mantenimiento automático para evitar bloqueos. En el nuevo repositorio fuera de OneDrive, `git fsck --full` y `git gc` funcionaron correctamente.

No borres manualmente:

```text
.git/
.git/objects/
```

## 8.3 Staging seguro

Nunca uses:

```powershell
git add .
git add -A
git commit -a
```

Agrega archivos explícitos.

Antes de cada commit:

```powershell
Stop-Process -Name node -Force -ErrorAction SilentlyContinue

git status --short
git diff --cached --name-only
git diff --cached --check
```

Filtro obligatorio:

```powershell
git diff --cached --name-only |
Select-String -Pattern "\.env$|certs/|cookies\.txt|data/.*\.db|data/.*\.sqlite|data/.*\.db-shm|data/.*\.db-wal|data/backups|mundipos-rootCA|\.pem$|\.key$|node_modules"
```

Debe quedar vacío.

Después:

```powershell
git commit -m "MENSAJE_CANONICO_DE_LA_FASE"
git push origin main
git status --short
```

No declares una fase cerrada si el estado no queda limpio o si el usuario no confirmó la operación.

---

# 9. Método obligatorio de trabajo para cada fase

Sigue este procedimiento en todas las fases futuras.

## Paso 1 · Confirmar punto de partida

- leer documentos canónicos;
- inspeccionar el código real;
- confirmar versión y último commit;
- revisar cambios sin commit;
- comprobar pruebas existentes;
- revisar migraciones y esquema actuales;
- identificar adaptadores legacy relacionados.

No programes sobre una copia antigua.

## Paso 2 · Auditar el dominio de la fase

Antes de editar, documenta:

- comportamiento actual;
- responsabilidades mezcladas;
- tablas y columnas relacionadas;
- rutas y componentes consumidores;
- riesgos de migración;
- compatibilidad visible;
- permisos requeridos;
- eventos realtime;
- impresión, si aplica;
- pruebas existentes y faltantes.

## Paso 3 · Definir alcance y no alcance

Cada implementación debe especificar:

- objetivo;
- cambios incluidos;
- cambios expresamente excluidos;
- dependencias con fases previas;
- invariantes que no pueden romperse;
- criterios de aceptación;
- estrategia de rollback.

No adelantes lógica de una fase posterior salvo infraestructura mínima indispensable y documentada.

## Paso 4 · Diseñar migración segura

Para cambios de base:

- migración idempotente;
- columnas/tablas sin perder datos;
- backfill controlado;
- índices necesarios;
- claves foráneas;
- compatibilidad con datos legacy;
- prueba sobre copia de base operativa;
- respaldo previo;
- `PRAGMA integrity_check` o equivalente;
- rollback de código y restauración de respaldo documentados.

No elimines tablas ni datos históricos en una fase de transición.

## Paso 5 · Implementar por servicios

Reglas:

- routers delgados;
- lógica de negocio en servicios;
- transacciones en servicios de dominio;
- backend recalcula precios, totales, saldos y estados;
- frontend no es fuente de verdad;
- mutaciones idempotentes cuando exista riesgo de reintento;
- control de versión/concurrencia;
- efectos externos después del commit;
- códigos de error de dominio estables;
- autorización backend por capacidad.

Las rutas legacy solo pueden permanecer como adaptadores temporales hacia servicios v3.

## Paso 6 · Mantener compatibilidad visible

- conservar etiquetas y puntos de entrada cuando sigan siendo correctos;
- adaptar PC y móvil;
- no crear módulos técnicos visibles para Payments o Printing;
- Caja permanece en el header;
- Impresoras permanece dentro de Configuración;
- cambiar UI solo cuando el nuevo flujo operativo lo exija;
- actualizar PWA y caché cuando cambie frontend.

## Paso 7 · Crear pruebas

Toda fase debe agregar pruebas específicas y ejecutar la suite completa.

Cobertura mínima:

- caso correcto;
- validaciones;
- autorización;
- rollback;
- idempotencia;
- concurrencia;
- datos legacy;
- lectura sin efectos secundarios;
- integridad financiera;
- contrato visual cuando aplique;
- PC/móvil mediante validación operativa.

Comandos base:

```powershell
npm ci
npm run test:sqlite-driver
npm test
```

Ejecuta además el script específico de la fase cuando exista.

## Paso 8 · Validar sintaxis y arranque

```powershell
node --check <archivos-backend-modificados>
node --check <archivos-frontend-modificados>
npm start
```

Validar por HTTPS, no solo por HTTP.

## Paso 9 · Documentar

Cada fase debe actualizar:

```text
README.md
docs/README-v3.0.md
docs/roadmap-v3.0-arquitectura-modular.md
docs/avance-vX.Y.Z-....md
package.json
server/config/appInfo.js
```

Cuando cambie frontend/PWA, revisar:

```text
public/index.html
public/service-worker.js
```

El avance debe indicar:

- objetivo;
- diseño;
- archivos;
- esquema/migración;
- API;
- UI;
- capacidades;
- realtime;
- compatibilidad;
- pruebas;
- limitaciones;
- validación operativa;
- commit exacto.

## Paso 10 · Entregar un ZIP autocontenido

El ZIP debe:

- contener solo archivos que deben copiarse sobre la raíz;
- preservar estructura de carpetas;
- no incluir la base;
- no incluir `.env`;
- no incluir certificados;
- no incluir claves;
- no incluir `.git`;
- no incluir `node_modules`;
- no incluir respaldos;
- no incluir archivos temporales;
- indicar claramente la versión.

Antes de afirmar que un ZIP existe, créalo y verifica su contenido.

## Paso 11 · Dar instrucciones de validación y Git

La respuesta de entrega debe incluir:

1. enlace al ZIP;
2. resumen de lo implementado;
3. migraciones;
4. pruebas ejecutadas y límites reales;
5. pruebas que el usuario debe correr;
6. validación operativa paso a paso;
7. lista explícita de archivos para `git add`;
8. filtro de seguridad;
9. commit canónico;
10. próxima fase.

No digas que una prueba nativa pasó si no se pudo ejecutar en el entorno de construcción.

## Paso 12 · Esperar confirmación

Después de entregar una fase, espera que el usuario confirme:

```text
Funcionando
Git completos
```

Solo entonces continúa con la siguiente fase.

---

# 10. Próxima fase: v3.3.0 · Dominio Kitchen / Comandas

## 10.1 Objetivo

Separar de Orders la lógica de preparación y establecer Kitchen como propietario del contenido y estado operativo de las comandas.

```text
Orders registra consumo y solicita envío.
Kitchen determina qué líneas nuevas o cambiadas deben prepararse.
Printing imprime el documento, pero no decide qué contiene ni su estado operativo.
```

## 10.2 Auditoría obligatoria previa

Antes de implementar, localiza:

- tabla actual `comandas` y tablas relacionadas;
- columnas que mezclen impresión y preparación;
- rutas de creación, pendientes, envío, reenvío y actualización;
- llamadas desde Orders;
- placeholders de impresión;
- lógica de productos que requieren cocina/bar;
- destino por categoría, subcategoría, producto o presentación;
- tratamiento de cantidades;
- modificaciones/anulaciones después del primer envío;
- realtime de cocina;
- permisos `kitchen.operate`;
- UI actual de comandas;
- comportamiento tras reinicio.

No asumas que la auditoría v3.0 sigue describiendo exactamente el código actual.

## 10.3 Alcance previsto

Implementar, según confirme el código actual:

```text
server/services/kitchenService.js
```

Responsabilidades:

- crear comandas a partir de cambios no enviados;
- identificar líneas por `pedido_producto_id` y cantidad;
- no reenviar unidades ya comandadas;
- enviar solo productos que requieren preparación;
- resolver destino cocina/bar de forma canónica;
- conservar presentación y descripción snapshot;
- registrar responsable y timestamps;
- manejar adiciones posteriores;
- manejar modificaciones y anulaciones mediante eventos/ajustes auditables;
- mantener idempotencia y concurrencia;
- publicar realtime después del commit.

## 10.4 Modelo sugerido, sujeto a auditoría

No impongas este modelo si el código actual ofrece una migración mejor, pero conserva los conceptos:

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
- pedido_producto_id
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

Printing no debe ser el dueño de `estado_operativo`.

## 10.5 Casos obligatorios

1. Agregar `Hamburguesa ×2` y enviar: Kitchen recibe exactamente dos unidades.
2. Volver a pulsar enviar sin cambios: no genera otra comanda equivalente.
3. Agregar una unidad adicional después: envía solo la nueva unidad.
4. Producto que no requiere preparación: no aparece.
5. Producto con presentación: conserva descripción exacta.
6. Cocina y bar: cada destino recibe únicamente sus ítems.
7. Modificación o anulación: queda registrada sin borrar historia.
8. Doble dispositivo: no duplica cantidades enviadas.
9. Falla de impresión futura: la comanda operativa sigue existiendo.
10. Reinicio del servidor: las comandas pendientes se recuperan.
11. Usuario sin `kitchen.operate`: no puede operar Kitchen.
12. Realtime: solo llega a usuarios y zonas/destinos autorizados.

## 10.6 No alcance de v3.3.0

No implementar todavía:

- cola definitiva de Printing;
- drivers térmicos;
- configuración de impresoras;
- todos los estados avanzados de preparación de `v3.3.1`;
- reportes finales de Kitchen;
- limpieza completa de legacy.

Puede incluir el estado mínimo necesario para compatibilidad, pero la trazabilidad completa corresponde a `v3.3.1`.

## 10.7 Criterios de aprobación

- Orders ya no decide directamente el contenido de una comanda;
- Kitchen genera únicamente cambios nuevos;
- no hay duplicación por reintento;
- productos sin preparación quedan fuera;
- destinos se separan correctamente;
- datos históricos se preservan;
- impresión no controla preparación;
- pruebas específicas y suite completa pasan;
- operación actual no se rompe;
- documentación y Git quedan completos.

Commit canónico:

```powershell
git commit -m "v3.3.0: separa dominio de Kitchen y comandas"
```

---

# 11. Alcance ampliado de las fases restantes

## v3.3.1 · Trazabilidad operativa de comandas

Estados canónicos previstos:

```text
pendiente
enviada
en_preparacion
lista
entregada
anulada
```

Debe implementar:

- historial por comanda e ítem;
- usuario que cambia estado;
- timestamps por transición;
- tiempos de espera y preparación;
- ajustes/anulaciones;
- read model para cocina/bar;
- recuperación tras reinicio;
- realtime de estados;
- protección de transiciones inválidas;
- idempotencia y versión.

No debe mezclar “impresa” con “enviada” o “en preparación”.

Commit:

```powershell
git commit -m "v3.3.1: agrega trazabilidad operativa de comandas"
```

## v3.4.0 · Núcleo y cola de Printing

Debe crear una infraestructura transversal persistente:

```text
trabajos_impresion
intentos_impresion
plantillas_documento
```

Estados sugeridos:

```text
pendiente
procesando
completado
fallido
cancelado
```

Debe incluir:

- `printingService`;
- identidad/idempotencia por documento, tipo y copia;
- vista previa;
- adaptador inicial navegador/PDF;
- base para drivers térmicos;
- intentos, errores y reintentos;
- recuperación después de reinicio;
- efectos posteriores al commit de negocio.

No debe recalcular importes ni contenido de negocio.

Commit:

```powershell
git commit -m "v3.4.0: crea nucleo y cola de Printing"
```

## v3.4.1 · Integración transversal de documentos

Integrar Printing con:

- prefactura normal;
- prefactura parcial;
- recibo/factura de pago;
- comprobante de crédito;
- abono;
- comanda cocina/bar;
- cierre diario;
- reimpresión autorizada.

Reglas:

- cada dominio entrega un read model canónico;
- reimpresión conserva el mismo número;
- cada copia e intento queda auditado;
- fallos no duplican operaciones;
- eliminar plantillas duplicadas en Orders/Caja/Créditos solo cuando todos los consumidores usen Printing.

Commit:

```powershell
git commit -m "v3.4.1: integra documentos operativos con Printing"
```

## v3.4.2 · Configuración → Impresoras

Crear una pestaña dentro de Configuración, no un módulo Printing visible.

Parámetros:

- impresora de Caja;
- impresora de cocina;
- impresora de bar;
- tamaño de papel;
- copias;
- autoimpresión;
- plantilla;
- prueba de impresión;
- estado del dispositivo.

Settings guarda configuración; Printing ejecuta.

Commit:

```powershell
git commit -m "v3.4.2: agrega configuracion central de impresoras"
```

## v3.5.0 · Dashboard y reportes financieros consolidados

Alinear definitivamente los indicadores con la cuenta global.

Debe revisar:

- ventas por cuenta global;
- movimientos de Caja por pago;
- créditos y abonos sin doble venta;
- consumo activo;
- documentos pendientes;
- filtros por cajero, método, zona y responsable;
- observación de cuenta dividida;
- fechas de venta versus fechas de movimiento;
- conciliación por período;
- ausencia total de cobro directo desde Dashboard.

Criterios:

- una cuenta dividida aparece como una venta;
- cada pago aparece como movimiento;
- pagadores parciales solo aparecen en detalle;
- responsable proviene de la cuenta global;
- no se duplica efectivo recibido con monto aplicado.

Commit:

```powershell
git commit -m "v3.5.0: consolida Dashboard reportes y movimientos de Caja"
```

## v3.5.1 · Realtime y recuperación operativa

Coordinar:

- Cuentas;
- Caja;
- Dashboard;
- Zonas;
- Kitchen;
- Printing.

Eventos mínimos:

```text
cuenta actualizada
prefactura emitida/anulada
pago confirmado/reversado
saldo actualizado
crédito formalizado/abonado
servicio finalizado
mesa liberada
comanda actualizada
impresión pendiente/fallida/completada
```

Debe incluir:

- filtrado por capacidades y zonas;
- recuperación de conexiones;
- recarga consistente de Caja;
- versión obsoleta/concurrencia;
- recuperación de trabajos pendientes;
- reintento idempotente;
- evitar polling agresivo.

Commit:

```powershell
git commit -m "v3.5.1: sincroniza Cuentas Caja Kitchen y Printing"
```

## v3.6.0 · Limpieza legacy y orden estructural

Solo cuando todos los consumidores usen los servicios v3:

- retirar lógica monetaria de Orders;
- retirar cobro directo de Dashboard;
- consolidar Accounts/Credits;
- eliminar endpoints legacy sin consumidores;
- eliminar fachadas temporales;
- retirar placeholders de impresión;
- dividir componentes frontend demasiado extensos;
- dejar routers delgados;
- eliminar funciones huérfanas y reglas duplicadas;
- documentar dependencias por dominio.

No eliminar nada basándose únicamente en una búsqueda textual. Identifica consumidores, pruebas y rutas activas.

Commit:

```powershell
git commit -m "v3.6.0: elimina legacy y ordena arquitectura modular"
```

## v3.7.0 · Pruebas cruzadas y cierre MundiPOS 3.0

Matriz mínima:

- administrador;
- cajero exclusivo;
- salonero con Caja;
- bartender con Caja;
- cuenta normal;
- cuenta dividida 2 + 1;
- múltiples líneas/cantidades;
- cliente que paga y se retira;
- consumo posterior a pago;
- saldo temporal cero;
- efectivo/vuelto;
- tarjeta;
- mixto;
- reverso;
- crédito y abonos;
- Kitchen cocina/bar;
- cambios/anulaciones de comanda;
- impresión fallida y reintento;
- dos dispositivos concurrentes;
- finalización y limpieza de responsables;
- una venta global con múltiples pagos;
- PC y PWA móvil por HTTPS.

MundiPOS 3.0 solo se cierra cuando:

- cuenta global es la única fuente financiera;
- prefacturas/pagos no duplican ventas;
- atención administra consumo y documentos;
- Caja cobra con autorización;
- Payments es atómico e idempotente;
- pagar no cierra mesas;
- finalizar servicio libera integralmente;
- Kitchen y Printing están desacoplados;
- Configuración administra impresoras;
- Dashboard concilia ventas y Caja;
- realtime coordina dispositivos;
- legacy fue retirado;
- pruebas automáticas y operativas están aprobadas.

Commit:

```powershell
git commit -m "v3.7.0: cierra arquitectura operativa de MundiPOS 3.0"
```

---

# 12. Restricciones y acciones prohibidas

No debes:

1. Reescribir el proyecto desde cero.
2. Reconstruir el código combinando ZIP de fases antiguas.
3. Trabajar sin inspeccionar el ZIP/repo más reciente.
4. Cambiar la cuenta global por una suma de prefacturas como fuente financiera.
5. Contabilizar prefacturas como ventas independientes.
6. Cerrar una mesa al pagar una prefactura.
7. Liberar mesa desde Payments.
8. Permitir cobro desde Dashboard.
9. Mover la división de cuenta a Caja.
10. Preparar varias subcuentas simultáneamente.
11. Reutilizar cantidades ya documentadas.
12. Confiar en montos enviados por frontend.
13. Proteger operaciones solo ocultando botones.
14. Emitir realtime antes del commit de la transacción.
15. Imprimir antes de persistir el documento.
16. Marcar una impresión como exitosa sin confirmación real.
17. Mezclar estado de impresión con estado de preparación Kitchen.
18. Eliminar historial financiero u operativo.
19. Eliminar tablas legacy antes de migrar consumidores.
20. Aplicar `npm audit fix --force` automáticamente.
21. Incluir bases, certificados, secretos o `node_modules` en ZIP/Git.
22. Usar `git add .`.
23. Borrar `.git` u objetos Git manualmente.
24. Volver a usar el repositorio activo dentro de OneDrive.
25. Cambiar HTTPS a HTTP como solución temporal para PWA.
26. Cambiar el puerto o IP sin evaluar certificados, origen PWA y documentación.
27. Afirmar que pruebas pasaron cuando no se ejecutaron.
28. Entregar un ZIP sin verificar que existe y contiene los archivos correctos.
29. Avanzar de fase sin confirmación operativa y Git completo.
30. Inventar rutas, tablas o archivos sin verificar el código actual.

---

# 13. Formato esperado de cada respuesta de implementación

La respuesta debe contener, en este orden:

1. Nombre exacto de la fase.
2. Enlace al ZIP creado.
3. Objetivo y reglas preservadas.
4. Cambios backend.
5. Cambios frontend.
6. Migración de base.
7. Capacidades/autorización.
8. Realtime.
9. Compatibilidad y no alcance.
10. Pruebas realmente ejecutadas.
11. Pruebas locales que debe ejecutar el usuario.
12. Validación operativa paso a paso.
13. Lista de archivos incluidos.
14. Comandos `git add` explícitos.
15. Filtro de seguridad.
16. Commit canónico.
17. Próxima fase.

No satures la respuesta con afirmaciones no verificadas. Distingue entre:

```text
validado en entorno de construcción
pendiente de validar en Windows
confirmado operativamente por el usuario
```

---

# 14. Cómo obtener el ZIP fuente para el nuevo chat

El nuevo chat no puede acceder a `C:\Repos\POS_Restaurante` directamente. El usuario debe adjuntar un ZIP actual.

Cuando el repositorio esté limpio y todos los cambios estén comprometidos, la forma más segura es:

```powershell
Set-Location C:\Repos\POS_Restaurante

git status --short
git archive --format=zip --output="$HOME\Desktop\POS_Restaurante_HEAD.zip" HEAD
```

Este ZIP contiene solamente archivos rastreados y excluye automáticamente:

- `.git`;
- base local;
- `.env`;
- certificados;
- `node_modules`;
- respaldos.

Adjuntar al nuevo chat:

```text
PROMPT-CONTINUIDAD-MUNDIPOS-3.0.md
POS_Restaurante_HEAD.zip
```

Si `v3.2.5` todavía no está aplicada/comprometida, adjuntar también:

```text
v3.2.5-finalizacion-servicio.zip
```

y aclarar expresamente que está pendiente de instalación o validación.

---

# 15. Primera respuesta esperada del nuevo chat

La primera respuesta del asistente debe demostrar que comprendió el traspaso y plantear una verificación concreta, sin comenzar a programar a ciegas.

Debe expresar esencialmente:

```text
1. Confirmaré si v3.2.5 está aplicada y cerrada.
2. Leeré los documentos canónicos y auditaré el código actual.
3. Verificaré Git, SQLite, HTTPS/PWA y pruebas.
4. Solo después iniciaré v3.3.0 Kitchen / Comandas.
5. No alteraré la cuenta global, Caja, Payments ni el flujo de división.
```

Después debe inspeccionar los archivos adjuntos y continuar con evidencia real.
