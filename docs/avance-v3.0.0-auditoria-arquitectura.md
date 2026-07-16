# v3.0.0 · Auditoría y contrato de arquitectura modular

## Resultado

Se confirma que MundiPOS puede evolucionar hacia una arquitectura separada de Cuentas, Pagos, Comandas e Impresiones sin cambiar el flujo visible del usuario, siempre que la migración se realice mediante servicios y fachadas de compatibilidad.

## Decisiones aprobadas

- La versión visible pasa a **3.0**.
- El versionado técnico comienza en **v3.0.0**.
- `Orders` conservará la UI de cuenta/pedido, pero dejará de contener reglas de cobro e impresión.
- `Payments` será un servicio interno invocado desde los botones actuales.
- `Kitchen` administrará el estado operativo de comandas.
- `Printing` administrará plantillas, trabajos, drivers y reimpresiones.
- No se crearán módulos visuales principales para Pagos ni Impresiones.
- La configuración de impresoras vivirá en una pestaña de Configuración.
- Los endpoints y métodos antiguos se conservarán temporalmente como adaptadores.

## Hallazgos principales

- `orders.js` frontend y backend mezclan demasiadas responsabilidades.
- Pagos y créditos ejecutan múltiples escrituras sin transacción única.
- No existe idempotencia para impedir cobros duplicados.
- El pago dividido no tiene persistencia suficiente.
- `accounts.js` y `credits.js` duplican lógica sobre `cuentas_credito`.
- Las impresiones actuales son placeholders o preparación de datos.
- Comandas mezcla estado operativo y estado de impresión.
- La configuración de impresora actual es una sola cadena de texto.
- Falta una suite de pruebas automatizadas.
- Las reglas de zona/responsabilidad deben extraerse de `tables.js`.

## Validación realizada

```powershell
node --check server/app.js
node --check server/db/database.js
node --check server/routes/orders.js
node --check server/routes/accounts.js
node --check server/routes/credits.js
node --check server/routes/settings.js
node --check server/routes/tables.js
node --check server/utils/realtime.js
node --check public/js/main.js
node --check public/js/components/orders.js
node --check public/js/components/accounts.js
node --check public/js/components/dashboard.js
node --check public/js/components/settings.js
```

También se validaron por sintaxis todos los archivos `.js` de `server/` y `public/js/`: 21 archivos sin errores de parseo.

## Archivos de esta fase

- `README.md`
- `package.json`
- `package-lock.json`
- `server/config/appInfo.js`
- `docs/auditoria-v3.0.0-arquitectura-modular.md`
- `docs/contrato-v3.0-compatibilidad-ui.md`
- `docs/roadmap-v3.0-arquitectura-modular.md`
- `docs/avance-v3.0.0-auditoria-arquitectura.md`

## Siguiente fase

```text
v3.0.1 · Infraestructura transaccional y pruebas base
```
