const database = require('../db/database');
const { ValidationError } = require('../errors/domainError');

const ACTIVE_SEAT_STATES = Object.freeze(['ocupada', 'reservada']);
const ACTIVE_ACCOUNT_STATES = Object.freeze(['abierta', 'finalizando']);

function normalizeUserId(userId) {
    const normalized = Number(userId);
    if (!Number.isSafeInteger(normalized) || normalized <= 0) {
        throw new ValidationError('ID de usuario inválido', { userId });
    }
    return normalized;
}

function getSeatCause(state) {
    if (state === 'ocupada') return 'mesa_ocupada';
    if (state === 'reservada') return 'mesa_reservada';
    return null;
}

class OperationalResponsibilityService {
    constructor(options = {}) {
        this.db = options.db || database;
    }

    async getUserResponsibilities(userId) {
        const normalizedUserId = normalizeUserId(userId);
        const rows = await this.db.all(`
            SELECT
                mr.mesa_id,
                mr.usuario_id,
                mr.rol_trabajo_id,
                mr.asignado_por_usuario_id,
                mr.fecha_asignacion,
                m.numero AS mesa_numero,
                m.nombre_visible AS mesa_nombre_visible,
                m.estado AS mesa_estado,
                m.activo AS mesa_activa,
                m.zona_id,
                m.tipo_puesto_id,
                m.zona AS zona_legacy,
                m.tipo_asiento AS tipo_puesto_legacy,
                m.cliente_nombre,
                z.nombre AS zona_nombre,
                z.slug AS zona_slug,
                tp.nombre AS tipo_puesto_nombre,
                tp.slug AS tipo_puesto_slug,
                rt.nombre AS rol_trabajo_nombre
            FROM mesa_responsables mr
            INNER JOIN mesas m ON m.id = mr.mesa_id
            LEFT JOIN zonas z ON z.id = m.zona_id
            LEFT JOIN tipos_puesto tp ON tp.id = m.tipo_puesto_id
            LEFT JOIN roles_trabajo rt ON rt.id = mr.rol_trabajo_id
            WHERE mr.usuario_id = ?
              AND COALESCE(m.activo, 1) = 1
              AND (
                  m.estado IN ('ocupada', 'reservada')
                  OR EXISTS (
                      SELECT 1
                      FROM pedidos p
                      WHERE p.mesa_id = m.id
                        AND p.estado_operativo IN ('abierta', 'finalizando')
                  )
              )
            ORDER BY
                COALESCE(z.orden, 2147483647) ASC,
                COALESCE(z.id, m.zona_id, 2147483647) ASC,
                m.numero ASC,
                m.id ASC
        `, [normalizedUserId]);

        const mesaIds = rows.map(row => Number(row.mesa_id));
        const accounts = mesaIds.length
            ? await this.db.all(`
                SELECT
                    id,
                    mesa_id,
                    numero_cuenta,
                    estado_operativo,
                    estado_financiero,
                    total_pagado,
                    saldo_pendiente
                FROM pedidos
                WHERE mesa_id IN (${mesaIds.map(() => '?').join(',')})
                  AND estado_operativo IN ('abierta', 'finalizando')
                ORDER BY mesa_id ASC, id ASC
            `, mesaIds)
            : [];

        const accountsBySeat = accounts.reduce((grouped, account) => {
            const mesaId = Number(account.mesa_id);
            if (!grouped.has(mesaId)) grouped.set(mesaId, []);
            grouped.get(mesaId).push({
                id: Number(account.id),
                numero_cuenta: account.numero_cuenta || null,
                estado_operativo: account.estado_operativo,
                estado_financiero: account.estado_financiero,
                total_pagado: Number(account.total_pagado || 0),
                saldo_pendiente: Number(account.saldo_pendiente || 0)
            });
            return grouped;
        }, new Map());

        const responsabilidades = rows.map(row => {
            const mesaId = Number(row.mesa_id);
            const estadoMesa = String(row.mesa_estado || '').trim().toLowerCase();
            const cuentasOperativas = accountsBySeat.get(mesaId) || [];
            const causas = [];
            const seatCause = getSeatCause(estadoMesa);
            if (seatCause) causas.push(seatCause);
            for (const account of cuentasOperativas) {
                causas.push(`cuenta_operativa_${account.estado_operativo}`);
            }

            return {
                tipo: 'mesa',
                id: mesaId,
                causas,
                mesa: {
                    id: mesaId,
                    numero: Number(row.mesa_numero),
                    nombre_visible: row.mesa_nombre_visible || null,
                    estado: estadoMesa,
                    activa: Number(row.mesa_activa ?? 1) === 1,
                    cliente_nombre: row.cliente_nombre || null,
                    zona: {
                        id: Number(row.zona_id || 0) || null,
                        nombre: row.zona_nombre || row.zona_legacy || null,
                        slug: row.zona_slug || row.zona_legacy || null
                    },
                    tipo_puesto: {
                        id: Number(row.tipo_puesto_id || 0) || null,
                        nombre: row.tipo_puesto_nombre || row.tipo_puesto_legacy || null,
                        slug: row.tipo_puesto_slug || row.tipo_puesto_legacy || null
                    }
                },
                asignacion: {
                    usuario_id: Number(row.usuario_id),
                    rol_trabajo_id: Number(row.rol_trabajo_id || 0) || null,
                    rol_trabajo_nombre: row.rol_trabajo_nombre || null,
                    asignado_por_usuario_id: Number(row.asignado_por_usuario_id || 0) || null,
                    fecha_asignacion: row.fecha_asignacion
                },
                cuentas_operativas: cuentasOperativas
            };
        });

        return {
            usuario_id: normalizedUserId,
            tiene_responsabilidad: responsabilidades.length > 0,
            total: responsabilidades.length,
            responsabilidades
        };
    }
}

const operationalResponsibilityService = new OperationalResponsibilityService();

module.exports = operationalResponsibilityService;
module.exports.OperationalResponsibilityService = OperationalResponsibilityService;
module.exports.ACTIVE_SEAT_STATES = ACTIVE_SEAT_STATES;
module.exports.ACTIVE_ACCOUNT_STATES = ACTIVE_ACCOUNT_STATES;
