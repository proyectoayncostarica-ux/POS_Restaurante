# Roadmap v2.2.5 · Normalización y Estabilización del módulo Cuentas / Orders

## Propósito

La fase **v2.2.5** tiene como objetivo sanear, normalizar y estabilizar por completo el módulo **Cuentas / Orders**, considerado el corazón operativo de MundiPOS.

Este módulo concentra las funciones más usadas por el usuario en operación diaria: creación de pedidos, agregar productos, manejo de presentaciones, cálculo de totales, servicio 10%, pagos, crédito, relación con mesas/puestos, responsabilidad operativa y sincronización con Dashboard y Zonas.

La fase debe ejecutarse con la misma dinámica usada en `v2.2.4`:

- Cada subfase se marca como `v2.2.5.x`.
- Cada bug derivado se marca como `fixN`, por ejemplo `v2.2.5.3 fix1`.
- No se avanza a la siguiente subfase hasta validar la anterior visual y operativamente.
- Cada subfase validada debe commitearse y pushearse antes de continuar.
- No se debe usar `git add .`.
- No se debe commitear `data/restaurant.db`, `.env`, `node_modules`, certificados, backups ni archivos temporales.

## Estado base

La fase parte desde el cierre de:

```text
v2.2.4.17 · Dashboard PC modo pantalla completa operativa
```

Y se apoya en la auditoría técnica documental:

```text
docs/auditoria-v2.2.5.0-modulo-cuentas-orders.md
```

## Objetivo general

Dejar el módulo Cuentas completamente ordenado, operativo y sano, eliminando lógica espagueti, duplicaciones y flujos legacy que conviven con flujos modernos.

El resultado esperado es:

- Backend de `orders.js` defensivo y consistente.
- Frontend de `orders.js` con una sola lógica de carrito/productos.
- Crear pedido y agregar productos usando la misma experiencia visual y lógica.
- Presentaciones y precios resueltos de forma única.
- Pagos, crédito, servicio y liberación de mesa consistentes.
- Responsabilidad operativa respetada desde Dashboard, Zonas y Cuentas.
- Realtime estable para cambios de cuentas.
- Código legacy identificado, aislado o eliminado.

---

# Reglas de ejecución de la fase

## Regla de avance

```text
Implementar subfase → entregar ZIP → probar visual/operativamente → corregir fixes → commit/push → continuar.
```

## Regla de commits

Cada subfase cerrada debe tener un commit propio.

Ejemplo:

```powershell
git commit -m "v2.2.5.3: centraliza precios y presentaciones en Cuentas"
git push origin main
```

Si hay fixes:

```powershell
git commit -m "v2.2.5.3 fix1: corrige cálculo de presentación en agregar productos"
git push origin main
```

## Regla de seguridad Git

Antes de cada commit:

```powershell
Stop-Process -Name node -Force -ErrorAction SilentlyContinue
git update-index --skip-worktree data/restaurant.db
git status --short
```

No commitear:

```text
data/restaurant.db
.env
node_modules/
certs/
*.pem
*.key
rootCA
mundipos-rootCA
data/backups/
cookies.txt
service-worker.js en raíz
```

Filtro obligatorio:

```powershell
git diff --cached --name-only | Select-String -Pattern "data/restaurant.db|\.env$|certs/|\.pem$|\.key$|rootCA|mundipos-rootCA|node_modules|cookies.txt|data/backups"
```

Si imprime algo, detenerse antes de commitear.

---

# v2.2.5.0 · Auditoría técnica del módulo Cuentas

## Estado

Realizada documentalmente.

## Objetivo

Inspeccionar el módulo Cuentas y sus interacciones para entender qué funciones están activas, cuáles son legacy, cuáles están repetidas y dónde existen riesgos operativos.

## Archivos revisados

```text
server/routes/orders.js
public/js/components/orders.js
server/routes/dashboard.js
public/js/components/dashboard.js
server/routes/tables.js
public/js/components/tables.js
server/routes/menu.js
server/routes/accounts.js
server/routes/credits.js
server/db/database.js
public/js/main.js
server/utils/realtime.js
```

## Resultado

Documento:

```text
docs/auditoria-v2.2.5.0-modulo-cuentas-orders.md
```

## Commit sugerido

```powershell
git commit -m "v2.2.5.0: documenta auditoría técnica del módulo Cuentas"
```

---

# v2.2.5.1 · Mapa funcional y contrato operativo de Cuentas

## Objetivo

Definir el contrato operativo real del módulo Cuentas antes de tocar lógica crítica.

Debe quedar claro qué hace Cuentas, qué hace Dashboard, qué hace Zonas y qué endpoints son oficiales.

## Alcance

Documentar:

- Qué es un pedido pendiente.
- Qué es una cuenta abierta.
- Qué es una cuenta pagada.
- Qué es una cuenta enviada a crédito.
- Qué significa agregar productos a un pedido existente.
- Qué puede hacer Dashboard sobre una cuenta.
- Qué puede hacer Zonas sobre una cuenta.
- Qué puede hacer Cuentas directamente.
- Qué endpoints se mantienen oficiales.
- Qué endpoints son legacy o candidatos a eliminación.

## Entregables

```text
docs/contrato-operativo-v2.2.5.1-cuentas.md
README.md actualizado
```

## No debe hacer

- No cambiar lógica.
- No modificar UI.
- No cambiar endpoints.
- No cambiar base de datos.

## Criterio de cierre

El contrato debe servir como guía para validar que las siguientes subfases no cambian la operación esperada.

## Commit sugerido

```powershell
git commit -m "v2.2.5.1: define contrato operativo del módulo Cuentas"
```

---

# v2.2.5.2 · Normalización backend de permisos, zona y responsabilidad

## Objetivo

Asegurar que `server/routes/orders.js` valide por sí mismo permisos, zonas y responsabilidad operativa.

El backend de Cuentas no debe depender solamente de que Dashboard o Zonas filtren correctamente en frontend.

## Alcance

Normalizar validaciones para:

- Admin global.
- Usuario estándar con roles activos.
- Usuario estándar responsable de mesa/cuenta.
- Usuario estándar no responsable.
- Usuario fuera de zona permitida.
- Sesión operativa multirrol.
- Responsabilidad compartida.

## Endpoints a revisar

```text
GET    /api/orders
GET    /api/orders/:id
POST   /api/orders
POST   /api/orders/:id/products
POST   /api/orders/:id/pay
POST   /api/orders/:id/credit
PUT    /api/orders/:pedido_id/products/:producto_id
GET    /api/orders/comandas/pending
PUT    /api/orders/comandas/:id/print
```

## Resultado esperado

Crear helpers internos o servicio común para validar acceso operativo antes de ejecutar acciones críticas.

## Criterio de cierre

- Admin puede operar cualquier cuenta.
- Usuario estándar solo opera cuentas propias/asignadas.
- Usuario fuera de zona no puede operar.
- Dashboard, Zonas y Cuentas siguen funcionando.
- Llamadas directas a API no saltan restricciones.

## Commit sugerido

```powershell
git commit -m "v2.2.5.2: normaliza permisos backend del módulo Cuentas"
```

---

# v2.2.5.3 · Servicio común de productos, precios y presentaciones

## Objetivo

Centralizar la resolución de productos, precios y presentaciones en backend.

## Problema actual

`POST /api/orders` y `POST /api/orders/:id/products` resuelven productos y presentaciones con lógica separada, lo que puede provocar:

- Precios incorrectos.
- Presentaciones mal calculadas.
- Productos duplicados.
- Subtotales inconsistentes.
- Diferencias entre crear pedido y agregar producto.

## Alcance

Crear una función común para resolver:

```text
producto_id
presentacion_id
nombre producto
nombre presentación
precio real
precio original
cantidad
subtotal
es_cocina
estado comanda
```

Puede vivir como helper interno en `server/routes/orders.js` o moverse a un servicio:

```text
server/services/orderPricingService.js
```

## Endpoints que deben usarlo

```text
POST /api/orders
POST /api/orders/:id/products
```

## Criterio de cierre

- Producto sin presentación calcula bien.
- Producto con presentación calcula bien.
- Cantidad multiplica correctamente.
- Precio mostrado coincide con precio guardado.
- Cocina/comanda no se rompe.
- Servicio 10% sigue calculando sobre el subtotal correcto.

## Commit sugerido

```powershell
git commit -m "v2.2.5.3: centraliza precios y presentaciones en Cuentas"
```

---

# v2.2.5.4 · Normalización del carrito frontend único

## Objetivo

Crear una sola lógica de carrito/selección en `public/js/components/orders.js`.

## Problema actual

El frontend mezcla múltiples modelos:

- `selectedProducts`.
- Selecciones temporales por presentación.
- Filas legacy del modal viejo.
- Totalizadores duplicados.
- Resúmenes distintos para crear y agregar productos.

## Funciones a revisar

```text
calculateTotal()
updateOrderTotal()
updateOrderResumenTotal()
getTotalSeleccionado()
calculateAddTotal()
renderResumenPresentaciones()
agregarProductoTemporal()
sumarProducto()
restarProducto()
```

## Resultado esperado

Un modelo único de carrito para:

- Crear pedido.
- Agregar productos.
- Productos con presentación.
- Productos sin presentación.
- Cantidades.
- Subtotales.
- Total visual.

## No debe hacer todavía

No es obligatorio rediseñar toda la UI en esta subfase. Primero se normaliza la lógica.

## Criterio de cierre

- Crear pedido sigue funcionando.
- Agregar productos sigue funcionando.
- Totales visuales no se duplican.
- Presentaciones no pierden precio.
- No se rompe móvil.

## Commit sugerido

```powershell
git commit -m "v2.2.5.4: normaliza carrito frontend de Cuentas"
```

---

# v2.2.5.5 · Unificación visual de Crear Pedido y Agregar Productos

## Objetivo

Eliminar la diferencia entre el modal moderno de Crear Pedido y el modal legacy de Agregar Productos.

## Problema actual

Crear Pedido usa:

- Categorías.
- Subcategorías.
- Cards visuales.
- Presentaciones.
- Resumen moderno.

Agregar Productos usa todavía:

- Selects.
- Filas legacy.
- Totalizadores antiguos.

## Alcance

Implementar la misma experiencia visual para ambos flujos:

- Cards de productos.
- Categorías y subcategorías.
- Selector de presentación.
- Cantidades.
- Resumen visual.
- Total.

## Criterio de cierre

- Desde Dashboard, Agregar Productos usa UI moderna.
- Desde Zonas, Agregar Productos usa UI moderna.
- Desde Cuentas, Agregar Productos usa UI moderna.
- Producto con presentación se agrega con precio correcto.
- Producto sin presentación se agrega con precio correcto.
- El flujo móvil sigue siendo usable.

## Commit sugerido

```powershell
git commit -m "v2.2.5.5: unifica modal de crear y agregar productos"
```

---

# v2.2.5.6 · Normalización de pagos, servicio 10%, crédito y liberación de mesa

## Objetivo

Garantizar que cerrar una cuenta deje todo consistente.

## Alcance

Revisar y normalizar:

- Pago contado.
- Pago tarjeta.
- SINPE.
- Pagos mixtos, si existen.
- Envío a crédito.
- Servicio 10%.
- `subtotal`.
- `monto_servicio`.
- `total_con_servicio`.
- Registro en `pagos`.
- Registro en `historial_transacciones`.
- Liberación de mesa.
- Limpieza de `mesa_responsables`.
- Realtime posterior al pago.

## Criterio de cierre

Después de pagar o enviar a crédito:

- Pedido queda en estado correcto.
- Pago queda registrado.
- Servicio queda registrado.
- Mesa queda libre cuando corresponda.
- Responsables se limpian.
- Dashboard se actualiza.
- Zonas se actualiza.
- Cuentas se actualiza.

## Commit sugerido

```powershell
git commit -m "v2.2.5.6: normaliza pagos credito servicio y liberacion de mesas"
```

---

# v2.2.5.7 · Revisión de comandas y productos de cocina

## Objetivo

Determinar si comandas queda funcional en esta fase o si se aísla como pendiente futuro.

## Contexto

Existen endpoints relacionados con comandas:

```text
GET /api/orders/comandas/pending
PUT /api/orders/comandas/:id/print
```

Y existe lógica de productos con `es_cocina`, pero el frontend de impresión/comanda no parece estar completo.

## Decisión requerida

Opción A:

```text
Normalizar comandas básicas y dejarlas funcionales.
```

Opción B:

```text
Documentar comandas como pendiente futuro y aislarlas para que no interfieran con Cuentas.
```

## Criterio mínimo de cierre

- Productos de cocina no rompen Cuentas.
- Si se registra comanda, se registra de forma consistente.
- Si impresión de comanda no está lista, queda documentada como pendiente.

## Commit sugerido

```powershell
git commit -m "v2.2.5.7: estabiliza flujo de comandas en Cuentas"
```

---

# v2.2.5.8 · Limpieza de funciones legacy, repetidas y huérfanas

## Objetivo

Eliminar o aislar código muerto y duplicado en `public/js/components/orders.js` y `server/routes/orders.js`.

## Funciones candidatas a revisión

```text
addProductRow()
updatePaymentTotal()
updateProductResumen()
updateOrderResumenTotal()
updateProductPrice()
calculateTotal()
addProductRowToList()
calculateAddTotal()
removeProductRow()
```

## Regla crítica

No eliminar una función hasta verificar que no esté llamada desde:

- HTML inline.
- Modales generados dinámicamente.
- Dashboard.
- Zonas.
- Orders.
- Realtime.

## Resultado esperado

- `orders.js` frontend más legible.
- Menos funciones duplicadas.
- Flujos legacy retirados o aislados.
- Comentarios claros donde algo se mantiene por compatibilidad.

## Commit sugerido

```powershell
git commit -m "v2.2.5.8: limpia funciones legacy del módulo Cuentas"
```

---

# v2.2.5.9 · Normalización de estados y textos operativos

## Objetivo

Unificar estados y textos entre Dashboard, Zonas y Cuentas.

## Estados a revisar

```text
pendiente
pagado
credito
cancelado
ocupada
reservada
libre
pedido activo
cuenta pendiente
cuenta pagada
responsable asignado
```

## Resultado esperado

Los textos operativos deben ser consistentes en toda la app.

Ejemplos de textos normalizados:

```text
Cuenta pendiente
Cuenta pagada
En crédito
Pedido activo
Mesa ocupada
Responsable asignado
```

## Criterio de cierre

- Dashboard muestra los mismos conceptos que Cuentas.
- Zonas muestra los mismos conceptos que Cuentas.
- No hay textos contradictorios entre “pedido” y “cuenta”.

## Commit sugerido

```powershell
git commit -m "v2.2.5.9: normaliza estados y textos de Cuentas"
```

---

# v2.2.5.10 · Realtime específico para Cuentas

## Objetivo

Asegurar que los cambios de Cuentas refresquen solo lo necesario y no generen regresiones.

## Eventos a revisar

- Crear pedido.
- Agregar productos.
- Editar productos.
- Pagar.
- Enviar a crédito.
- Liberar mesa.
- Cambiar responsabilidad.
- Cambiar roles activos.

## Resultado esperado

- Dashboard se actualiza cuando corresponde.
- Zonas se actualiza cuando corresponde.
- Cuentas se actualiza cuando corresponde.
- Créditos se actualiza cuando corresponde.
- Usuarios no relacionados no reciben refrescos innecesarios.

## Commit sugerido

```powershell
git commit -m "v2.2.5.10: adapta realtime al flujo de Cuentas"
```

---

# v2.2.5.11 · Pruebas operativas cruzadas Dashboard → Cuentas → Zonas

## Objetivo

Validar el módulo desde operación real.

## Checklist obligatorio

```text
1. Abrir mesa desde Dashboard.
2. Crear pedido con producto sin presentación.
3. Crear pedido con producto con presentación.
4. Agregar productos a pedido existente.
5. Agregar otra presentación del mismo producto.
6. Cobrar contado.
7. Cobrar con servicio.
8. Enviar a crédito.
9. Liberar mesa.
10. Reasignar responsables.
11. Usuario estándar responsable opera.
12. Usuario estándar no responsable queda bloqueado.
13. Admin opera cualquier cuenta.
14. Usuario multirrol ve zonas correctas.
15. Dashboard pantalla completa sigue funcionando.
16. Zonas sigue funcionando.
17. Cuentas lista pendientes/pagadas correctamente.
```

## Entregable

```text
docs/pruebas-operativas-v2.2.5.11-cuentas.md
```

## Commit sugerido

```powershell
git commit -m "v2.2.5.11: documenta pruebas operativas del módulo Cuentas"
```

---

# v2.2.5.12 · Cierre técnico y estabilización final

## Objetivo

Cerrar la fase v2.2.5 como estable.

## Entregables

```text
docs/cierre-v2.2.5-estabilizacion-cuentas.md
README.md actualizado
server/config/appInfo.js actualizado
public/index.html versionado
public/service-worker.js versionado
```

## Validaciones de sintaxis finales

```powershell
node --check server/app.js
node --check server/db/database.js
node --check server/routes/auth.js
node --check server/routes/tables.js
node --check server/routes/orders.js
node --check server/routes/dashboard.js
node --check server/routes/settings.js
node --check server/routes/users.js
node --check server/utils/realtime.js
node --check public/js/main.js
node --check public/js/components/dashboard.js
node --check public/js/components/tables.js
node --check public/js/components/orders.js
node --check public/js/components/users.js
node --check public/service-worker.js
```

## Commit y tag sugeridos

```powershell
git commit -m "v2.2.5: cierra estabilización del módulo Cuentas"
git push origin main
git tag v2.2.5-cierre
git push origin v2.2.5-cierre
```

---

# Orden recomendado de ejecución

```text
v2.2.5.0  Auditoría técnica
v2.2.5.1  Contrato operativo
v2.2.5.2  Permisos backend
v2.2.5.3  Productos/precios/presentaciones backend
v2.2.5.4  Carrito frontend único
v2.2.5.5  UI unificada crear/agregar productos
v2.2.5.6  Pagos/crédito/servicio/liberación
v2.2.5.7  Comandas
v2.2.5.8  Limpieza legacy
v2.2.5.9  Estados/textos
v2.2.5.10 Realtime Cuentas
v2.2.5.11 Pruebas cruzadas
v2.2.5.12 Cierre
```

## Prioridad real

La prioridad no debe ser visual al inicio. El orden más seguro es:

```text
1. Backend seguro.
2. Productos, precios y presentaciones consistentes.
3. Carrito único.
4. UI unificada.
5. Pagos y limpieza.
6. Realtime.
7. Limpieza final.
```

## Criterio final de éxito de v2.2.5

La fase se considera cerrada cuando:

- Crear pedido funciona desde Dashboard, Zonas y Cuentas.
- Agregar productos funciona igual que crear pedido.
- Productos con presentación mantienen precio correcto.
- Servicio 10% calcula y registra correctamente.
- Pago y crédito liberan o mantienen estado según corresponda.
- Responsabilidad operativa se respeta.
- Usuarios estándar no pueden saltarse permisos.
- Admin mantiene control global.
- No quedan funciones críticas duplicadas o legacy en flujo activo.
- Cuentas queda documentado, trazable y estable.
