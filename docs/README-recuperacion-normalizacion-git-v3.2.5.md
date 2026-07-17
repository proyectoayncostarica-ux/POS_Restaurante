# Recuperación y normalización Git · MundiPOS v3.2.1 a v3.2.5

## Propósito

Este documento registra la recuperación controlada de las fases `v3.2.1` a `v3.2.5`, la normalización del historial Git y la integración final en `main` y `origin/main`.

La intervención fue necesaria porque el desarrollo funcional existía en entregas parciales y respaldos de fase, pero el repositorio principal permanecía detenido en `v3.2.0 fix2`. El objetivo fue reconstruir el avance sin perder la base operativa, secretos locales, certificados, dependencias nativas ni historial útil.

Esta fue una fase de recuperación y control de versiones. No introdujo una versión funcional posterior a `3.2.5`.

## Estado inicial

Repositorio activo:

```text
C:\Repos\POS_Restaurante
```

Repositorio anterior dentro de OneDrive, conservado solo como respaldo:

```text
C:\Users\andre\OneDrive\Documentos\Proyecto\POSRestaurante\POS_Restaurante_RESPALDO_NO_USAR
```

Al iniciar la recuperación:

- `main` y `origin/main` apuntaban a `141735c`;
- el último estado principal era `v3.2.0 fix2`;
- las fases posteriores estaban disponibles como ZIP independientes;
- existía una base SQLite operativa que no debía modificarse ni reconstruirse;
- se creó y conservó un stash de seguridad;
- se trabajó en una rama independiente para evitar alterar `main` antes de validar toda la secuencia.

Stash preservado:

```text
stash@{0}: On main: RECOVERY v3.2.1 a v3.2.5 antes de reconstruir 20260717-111223
```

Rama de recuperación:

```text
recovery/v3.1.3-a-v3.2.5
```

Respaldos de ramas creados durante el proceso:

```text
backup/main-antes-reconstruccion
backup/recovery-v3.2.5-antes-integracion
```

## Reglas de seguridad aplicadas

Durante la recuperación se mantuvieron estas restricciones:

- no usar `git reset --hard`;
- no usar `git clean`;
- no usar `git add .` ni `git add -A`;
- no aplicar, extraer ni eliminar el stash de recuperación;
- no reescribir ramas publicadas;
- no sobrescribir `.env`, certificados, claves o cookies;
- no incluir `node_modules`;
- no ejecutar nuevamente una recuperación SQLite;
- no alterar `data/restaurant.db`;
- mantener `sqlite3` exactamente en `6.0.1`;
- mantener Node con requisito `>=20.17.0`;
- ejecutar staging explícito por archivo;
- validar pruebas, auditoría y archivos sensibles antes de cada commit.

La base operativa se verificó como ignorada:

```text
.gitignore:20:data/*.db data/restaurant.db
```

## Método de reconstrucción

Cada ZIP de fase fue tratado como una entrega parcial, no como un repositorio completo.

Para cada fase se realizó:

1. extracción en un directorio de inspección aislado;
2. inventario de archivos;
3. comparación contra el árbol vigente;
4. revisión de servicios, rutas, esquema, UI y pruebas;
5. exclusión de cambios no confiables en `package.json` y `package-lock.json`;
6. importación explícita únicamente de los archivos de la fase;
7. actualización mínima y manual de versión y scripts;
8. validación sintáctica;
9. ejecución de pruebas específicas;
10. ejecución de la suite completa;
11. auditoría de dependencias;
12. staging explícito;
13. escaneo de archivos sensibles;
14. commit de la fase;
15. verificación posterior al commit.

Los manifiestos de los ZIP no se copiaron completos cuando eliminaban scripts preservados o contenían cambios secundarios de lockfile. Se aplicaron únicamente las diferencias necesarias de versión y scripts de prueba.

## Fases recuperadas

### v3.2.1 · API y read model operativo de Caja

Commit:

```text
4107e50 v3.2.1: agrega API y read model operativo de Caja
```

Resultado principal:

- API de Caja;
- cola de prefacturas;
- lectura de detalle;
- movimientos por cuenta global;
- read model autorizado y separado de Payments.

### v3.2.2 · Interfaz de Caja y modal operativo de cobro

Commit:

```text
a09e7b6 v3.2.2: agrega interfaz de Caja y modal operativo de cobro
```

Resultado principal:

- interfaz visible de Caja;
- modal operativo de cobro;
- separación entre consulta, cobro y reimpresión;
- adaptación para PC y móvil.

### v3.2.3 · Efectivo, tarjeta, vuelto y pagos mixtos

Commit:

```text
417258d v3.2.3: agrega efectivo tarjeta vuelto y pagos mixtos
```

Resultado principal:

- efectivo con monto recibido y vuelto;
- tarjeta con referencia obligatoria;
- pagos mixtos atómicos;
- medios de pago persistentes;
- idempotencia y rollback.

Validación de la fase:

```text
91/91 pruebas aprobadas
0 vulnerabilidades
```

### v3.2.4 · Créditos integrados con Payments

Commit:

```text
9598fff v3.2.4: integra creditos con Payments y cuenta global
```

Resultado principal:

- formalización de crédito desde prefactura;
- pago de apertura mediante Payments;
- abonos como cobros de crédito;
- prevención de doble contabilización;
- autorización administrativa;
- reversos e idempotencia;
- cartera de créditos integrada con Caja.

Validación de la fase:

```text
101/101 pruebas aprobadas
0 vulnerabilidades
```

### v3.2.5 · Finalización del servicio y liberación integral

Commit:

```text
b317d52 v3.2.5: finaliza servicio y libera mesas integralmente
```

Resultado principal:

- cierre operativo separado del saldo financiero;
- lectura previa de integridad;
- autorización por responsabilidad de mesa;
- idempotencia y control de versión;
- cierre de cuenta y liberación de mesa en una sola transacción;
- conservación del historial;
- soporte de créditos formalizados aún pendientes en cartera.

Validación final:

```text
6/6 pruebas específicas de finalización
10/10 pruebas de créditos
7/7 pruebas de UI de Caja
2/2 pruebas del driver SQLite
107/107 pruebas de la suite completa
0 vulnerabilidades
```

## Normalización de historiales

Después de reconstruir `v3.2.5`, la rama `recovery` no podía avanzar directamente sobre `main` porque ambos historiales habían divergido.

Comparación inicial:

```text
git rev-list --left-right --count main...recovery/v3.1.3-a-v3.2.5
5       12
```

La revisión con `--cherry-mark` mostró:

- commits equivalentes con hashes diferentes para `fix1` y `fix2`;
- árboles idénticos para `v3.1.4`, `v3.2.0` y `fix2`;
- solo dos líneas en blanco de diferencia documental en `v3.1.5`;
- fases nuevas válidas únicamente en la rama de recuperación.

Comparaciones relevantes:

```text
cfd4c4e ↔ b686b82  árboles idénticos

d57b3be ↔ 6973218  árboles idénticos

141735c ↔ ba0636b  árboles idénticos

e6bc0af ↔ 20e079e  solo dos líneas en blanco documentales
```

No se utilizó un merge convencional porque podía reintroducir fragmentos antiguos desde `main` sobre el árbol reconstruido.

## Integración segura del historial

Primero se creó un respaldo del extremo funcional recuperado:

```text
backup/recovery-v3.2.5-antes-integracion → b317d52
```

Luego, desde la rama `recovery`, se conectó el historial de `main` usando la estrategia `ours`:

```powershell
git merge --strategy=ours main -m "merge: integra historial de main preservando v3.2.5 reconstruida"
```

Commit de integración:

```text
d5edf05 merge: integra historial de main preservando v3.2.5 reconstruida
```

La estrategia se aplicó únicamente después de comparar los árboles y confirmar la equivalencia funcional de los commits divergentes.

Se verificó que el contenido no cambiara durante el merge:

```text
Árbol anterior: 36588e6a0108dc93568dbf9ae686a9ce53dea919
Árbol posterior: 36588e6a0108dc93568dbf9ae686a9ce53dea919
```

El historial quedó conectado de forma que `main` era ancestro directo del resultado:

```text
git rev-list --left-right --count main...HEAD
0       13
```

## Avance de main

Después de conectar los historiales, `main` se actualizó mediante fast-forward estricto:

```powershell
git switch main
git merge --ff-only recovery/v3.1.3-a-v3.2.5
```

Verificación:

```text
main y recovery: 0 commits de diferencia
package.json: 3.2.5
working tree: clean
sqlite3: 6.0.1
stash: intacto
```

## Publicación

La rama principal se publicó sin reescritura forzada:

```powershell
git push origin main
```

Resultado:

```text
141735c..d5edf05  main -> main
```

Estado publicado:

```text
main local    → d5edf05
origin/main   → d5edf05
recovery      → d5edf05
```

No se utilizó `--force` ni se modificó el historial remoto existente fuera de un avance normal.

## Estado final confirmado

```text
Rama activa: main
HEAD: d5edf05
Versión: 3.2.5
SQLite: 6.0.1
Suite completa: 107/107
Auditoría: 0 vulnerabilidades
Árbol de trabajo: limpio
Base operativa: ignorada
Stash de recuperación: intacto
```

Cadena funcional recuperada:

```text
fde48ee  v3.1.3 · Emisión guiada de prefacturas divididas
b686b82  v3.1.4 · Continuidad de cuentas después de pagos
20e079e  v3.1.5 · Read model financiero consolidado
6973218  v3.2.0 · Payments por prefactura
0721a08  v3.2.0 fix1 · Dependencias compatibles
ba0636b  v3.2.0 fix2 · Exclusión de SQLite operativo
da5deaa  v3.2.0 fix3 · Driver SQLite y script PowerShell
4107e50  v3.2.1 · API y read model de Caja
a09e7b6  v3.2.2 · Caja visual y modal de cobro
417258d  v3.2.3 · Medios de pago
9598fff  v3.2.4 · Créditos integrados
b317d52  v3.2.5 · Finalización del servicio
d5edf05  Integración normalizada en main
```

## Salvaguardas que permanecen

No eliminar ni aplicar automáticamente:

```text
stash@{0}: RECOVERY v3.2.1 a v3.2.5 antes de reconstruir 20260717-111223
```

Conservar hasta que exista una decisión explícita:

```text
backup/main-antes-reconstruccion
backup/recovery-v3.2.5-antes-integracion
recovery/v3.1.3-a-v3.2.5
```

Estas referencias permiten comparar o volver a inspeccionar el proceso sin alterar `main`.

## Hallazgo posterior pendiente

Al generar un `git archive` del `HEAD` se comprobó que existen archivos previamente rastreados que siguen entrando en el ZIP aunque ahora coincidan con reglas de `.gitignore`.

Respaldos SQLite detectados:

```text
data/backups/backup-2025-07-06T07-14-23-209Z.db
data/backups/backup-before-reset-2025-07-10T00-07-14-393Z.db
data/backups/backup-before-reset-2025-07-14T14-59-31-972Z.db
```

También se detectó:

```text
.vscode/settings.json
```

`.gitignore` no deja de rastrear archivos que ya fueron agregados previamente. Por tanto:

- los respaldos están presentes en el historial actual;
- `git archive` los incluye;
- el problema no debe considerarse corregido todavía;
- no deben borrarse del disco local durante la corrección;
- deben retirarse del índice de forma explícita y controlada;
- antes de modificar el historial publicado debe evaluarse si contienen datos sensibles y definir una estrategia separada.

Esta limpieza debe tratarse como una subfase de higiene Git antes de entregar nuevos ZIP de implementación.

## Lecciones operativas

1. Un ZIP de fase no debe asumirse como snapshot completo del repositorio.
2. Los manifiestos deben compararse y aplicarse de forma mínima.
3. Dos commits con mensajes equivalentes pueden tener hashes distintos y árboles idénticos.
4. Antes de unir ramas divergentes se deben comparar commits, parches y árboles.
5. La estrategia `ours` solo es segura cuando se documenta por qué se preserva un árbol y se valida su hash antes y después.
6. `git merge --ff-only` es preferible para mover `main` después de conectar correctamente los historiales.
7. `.gitignore` no protege archivos ya rastreados.
8. `git archive` excluye archivos no rastreados, pero incluye cualquier archivo rastreado aunque esté ignorado actualmente.
9. La base operativa, secretos y certificados deben verificarse tanto en staging como en el contenido real del ZIP.
10. La fase no está completa hasta confirmar pruebas, árbol limpio, commit y publicación.

## Próxima actividad funcional

Después de resolver o aceptar explícitamente el hallazgo de higiene Git, la siguiente fase funcional es:

```text
v3.3.0 · Dominio Kitchen / Comandas
```

No se debe generar código de Kitchen sin auditar primero el `HEAD v3.2.5`, sus documentos canónicos, tablas, rutas, componentes, permisos, realtime y lógica legacy de comandas.

## Commit documental sugerido

```powershell
git commit -m "docs: documenta recuperacion y normalizacion Git v3.2.5"
```
