# Avance v4.3.1 — Responsabilidades operativas canónicas

## 1. Estado inicial

v4.3.1 se inició desde la base documental publicada `928b411f862641edf5932af871ad73974af14968`, en la rama `main` y con el working tree limpio.

## 2. Objetivo

Definir una única fuente backend, persistida y reutilizable para responder si un `usuario_id` mantiene responsabilidades operativas activas y exponer evidencia estructurada de las entidades que las originan.

v4.3.1 solo incorpora la evaluación read-only. El bloqueo del logout pertenece a v4.3.2 y la corrección de su UX pertenece a v4.3.3.

## 3. Auditoría realizada

### Documentación canónica revisada

- `README.md`.
- `docs/roadmap-v4-sesiones-continuidad-operativa.md`.
- `docs/avance-v4.2.2-ciclo-vida-sesiones.md`.
- `docs/contrato-v3.0-operacion-caja-prefacturas.md`.
- `docs/contrato-v3.0-cuenta-global-fuente-financiera.md`.
- `docs/avance-v3.2.5-finalizacion-servicio.md`.
- `docs/avance-v3.0.3-acceso-operativo-realtime.md`.
- `docs/avance-v3.1.0-cuenta-global-servicio-cuentas.md`.
- `docs/roadmap-v2.2.4-zonas-roles-permisos.md`.

### Modelo persistido

- `mesas.estado` usa `libre`, `ocupada` y `reservada`. `ocupada` y `reservada` representan trabajo operativo vigente; `libre` representa un puesto liberado.
- `mesa_responsables` relaciona autoritativamente `mesa_id` con `usuario_id`, rol y fecha de asignación. Su clave `(mesa_id, usuario_id)` admite responsabilidad compartida sin duplicar una asignación.
- `pedidos` es la cuenta global de la venta. `estado_operativo` separa la vida del servicio de `estado_financiero`, `total_pagado` y `saldo_pendiente`. Para esta evaluación, `abierta` y `finalizando` son estados vigentes; `cerrada` y `cancelada` no representan un servicio activo.
- `cuenta_responsables` conserva snapshots históricos al crear la cuenta. No es una fuente de responsabilidad actual.
- `sesiones_usuario` y `express_sessions` describen autenticación y ciclo de vida de sesión, no trabajo operativo.

### Rutas y servicios relevantes

- `server/routes/tables.js` asigna `mesa_responsables` al abrir o reservar, conserva la asignación al ocupar una reserva y la elimina al cerrar/liberar.
- `server/services/accountService.js` crea la cuenta global desde una mesa ocupada, copia responsables a `cuenta_responsables` como historial y separa las dimensiones operativa y financiera.
- `server/services/serviceFinalizationService.js` finaliza transaccionalmente: cierra `pedidos.estado_operativo`, cambia la mesa a `libre` y elimina `mesa_responsables`.
- `server/services/operationalAccessService.js`, `server/routes/tables.js`, `server/routes/orders.js` y `server/routes/auth.js` ya consultan `mesa_responsables` para acceso operativo o cambios de rol.
- Pagos, prefacturas y créditos actualizan la dimensión financiera, pero no liberan la mesa ni eliminan la responsabilidad.

La auditoría confirmó el escenario A: el esquema existente es suficiente y autoritativo. No se requiere migración ni cambio de base de datos.

## 4. Definición resultante

Un usuario tiene responsabilidad operativa activa cuando existe una asignación persistida en `mesa_responsables` para una mesa/puesto activo y se cumple al menos una condición:

1. la mesa está `ocupada`;
2. la mesa está `reservada`;
3. la mesa conserva una cuenta global con `pedidos.estado_operativo` en `abierta` o `finalizando`.

El resultado agrega una responsabilidad lógica por mesa/puesto. Las cuentas globales operativamente activas son evidencia anidada, no una segunda responsabilidad. El orden es estable por zona, número de mesa e identificador.

El resultado es falso si no existe una asignación viva que cumpla esas condiciones. Una mesa `libre` con cuentas `cerrada` o `cancelada` no cuenta; tampoco un snapshot en `cuenta_responsables`.

## 5. Qué NO representa responsabilidad

No se usa como fuente:

- `sesiones_usuario` ni `express_sessions`;
- `client_id`, Socket.IO, Realtime, navegador o última actividad;
- saldo, estado financiero o pagos por sí solos;
- una prefactura;
- `cuenta_responsables` histórico;
- el último usuario que modificó, cobró o imprimió.

Administradores y cuentas departamentales no reciben excepciones en esta subfase: una asignación operativa se evalúa con la misma fuente.

## 6. Implementación

- `server/services/operationalResponsibilityService.js` centraliza `getUserResponsibilities(userId)`.
- La consulta es read-only y admite inyección de base de datos para pruebas aisladas.
- La salida contiene `usuario_id`, `tiene_responsabilidad`, `total` y `responsabilidades`, con causas, mesa/puesto, asignación y cuentas operativas relacionadas.
- No se integró el servicio con `/logout` ni con otra ruta.

## 7. Tests validados

`tests/operationalResponsibilityService.test.js` prepara:

1. usuario válido sin responsabilidad;
2. mesa ocupada asignada;
3. trabajo activo de otro usuario;
4. servicio finalizado/liberado con snapshot histórico, usando `estado = 'pagado'`, `estado_operativo = 'cerrada'` y `estado_financiero = 'conciliada'`;
5. cuenta conciliada y con saldo cero cuyo servicio sigue abierto;
6. varias responsabilidades con orden determinista;
7. responsabilidad persistida sin `sesiones_usuario`;
8. verificación read-only sobre el estado de `mesas`, `mesa_responsables` y `pedidos`.

Resultados registrados:

- prueba específica v4.3.1: **8/8**;
- regresiones dirigidas: **20/20**;
- suite completa: **214/214**;
- fallos: **0**;
- cancelados: **0**;
- omitidos: **0**;
- pendientes: **0**;
- `node --check server/services/operationalResponsibilityService.js`: **Exit code 0**;
- `node --check tests/operationalResponsibilityService.test.js`: **Exit code 0**;
- `git diff --check`: **OK**;
- validación manual: **no aplicable**.

La validación manual no aplica porque v4.3.1 es un servicio backend interno y read-only, todavía no integrado con `/logout`, sin endpoint o flujo de usuario nuevo y sin cambios de frontend. Sus contratos operacionales quedaron comprobados mediante fixtures específicas, regresiones dirigidas y la suite completa.

El fixture final real representa una cuenta pagada y conciliada cuyo servicio sí terminó: `estado = 'pagado'`, `estado_operativo = 'cerrada'` y `estado_financiero = 'conciliada'`. La mesa está `libre`; conservar `cuenta_responsables` en ese escenario solo preserva historial y no atribuye responsabilidad operativa actual.

En cambio, `estado = 'pagado'`, `estado_financiero = 'conciliada'` y `estado_operativo = 'abierta'` continúa representando responsabilidad operacional mientras la mesa o el servicio sigan activos.

## 8. Contratos preservados

- pago != finalización del servicio;
- saldo cero != liberación de mesa;
- conciliación financiera != cierre operacional;
- la cuenta global sigue siendo la única cuenta financiera;
- una prefactura no es una venta separada;
- los pagos pertenecen a Caja;
- la finalización explícita es la señal de cierre y liberación;
- el backend persistido es la autoridad;
- el historial permanece intacto.

## 9. Fuera de alcance

No se implementó:

- v4.3.2: integración con `/logout`, bloqueo backend, respuesta HTTP de conflicto, preservación condicional de sesión o detalle de responsabilidades en una respuesta de logout;
- v4.3.3: cambios en el botón de logout, modal o mensaje de advertencia, UX frontend, navegación o recuperación visual;
- v4.4+: límites de concurrencia, máximo de dispositivos, heartbeat, presencia, takeover, transferencia o revocación;
- cambios de schema, sesiones, autenticación, pagos, Caja o finalización.

## 10. Estado

**PUBLICADA.**

Commit funcional/publicado de v4.3.1: `599893301c91fa7644c8e5fc7f73d8753b9a20b9`.
Después del push funcional se confirmó `main == origin/main` y el working tree limpio.
