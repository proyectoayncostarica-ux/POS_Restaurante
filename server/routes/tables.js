const express = require('express');
const database = require('../db/database');

const router = express.Router();

function normalizeSlug(value, fallback = 'mesa') {
    const rawValue = String(value || fallback).trim().toLowerCase();
    const normalized = rawValue
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/ñ/g, 'n')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

    return normalized || fallback;
}

function legacyZoneSlugForSeat({ zona, tipo_asiento } = {}) {
    const zonaSlug = normalizeSlug(zona || 'salon', 'salon');
    const tipoSlug = normalizeSlug(tipo_asiento || 'mesa', 'mesa');

    if (zonaSlug === 'bar' && tipoSlug === 'banco') return 'barra';
    if (zonaSlug === 'barra') return 'barra';
    return zonaSlug;
}

function legacySeatTypeSlug({ tipo_asiento } = {}) {
    return normalizeSlug(tipo_asiento || 'mesa', 'mesa');
}

function legacySeatName(mesa = {}) {
    const zona = String(mesa.zona || '').toLowerCase();
    const tipo = String(mesa.tipo_asiento || 'mesa').toLowerCase();
    return zona === 'bar' && tipo === 'banco' ? 'banco' : 'mesa';
}

async function getDynamicZoneAndTypeIds({ zona, tipo_asiento }) {
    const zonaSlug = legacyZoneSlugForSeat({ zona, tipo_asiento });
    const tipoSlug = legacySeatTypeSlug({ tipo_asiento });

    let [zonaRow, tipoRow] = await Promise.all([
        database.get('SELECT id FROM zonas WHERE slug = ? AND activa = 1', [zonaSlug]),
        database.get('SELECT id FROM tipos_puesto WHERE slug = ? AND activo = 1', [tipoSlug])
    ]);

    if (!zonaRow?.id || !tipoRow?.id) {
        await database.ensureDynamicModelConsistency();
        [zonaRow, tipoRow] = await Promise.all([
            database.get('SELECT id FROM zonas WHERE slug = ? AND activa = 1', [zonaSlug]),
            database.get('SELECT id FROM tipos_puesto WHERE slug = ? AND activo = 1', [tipoSlug])
        ]);
    }

    return {
        zona_id: zonaRow?.id || null,
        tipo_puesto_id: tipoRow?.id || null,
        zona_slug: zonaSlug,
        tipo_puesto_slug: tipoSlug
    };
}


function requireAdmin(req, res, next) {
    if (req.session?.userType === 'administrador') {
        return next();
    }

    return res.status(403).json({ error: 'Solo un administrador puede modificar la estructura del local' });
}

function toBooleanFlag(value, defaultValue = true) {
    if (value === undefined || value === null || value === '') return defaultValue ? 1 : 0;
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (typeof value === 'number') return value ? 1 : 0;

    const normalized = String(value).trim().toLowerCase();
    return ['1', 'true', 'si', 'sí', 'on', 'yes'].includes(normalized) ? 1 : 0;
}

function toOptionalOverride(value) {
    if (value === undefined || value === null || value === '' || value === 'heredar') return null;
    return toBooleanFlag(value, false);
}

function toInteger(value, defaultValue = 0) {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : defaultValue;
}

function toServicePercentage(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 10;
    return Math.min(Math.max(parsed, 0), 100);
}

function validateName(nombre, label = 'nombre') {
    const cleanName = String(nombre || '').trim().replace(/\s+/g, ' ');

    if (!cleanName) {
        return { error: `El ${label} es requerido` };
    }

    if (cleanName.length < 2) {
        return { error: `El ${label} debe tener al menos 2 caracteres` };
    }

    if (cleanName.length > 40) {
        return { error: `El ${label} no debe superar 40 caracteres` };
    }

    return { nombre: cleanName };
}

function buildLegacySeatValuesFromDynamic(zone = {}, seatType = {}) {
    const zoneSlug = normalizeSlug(zone.slug || zone.nombre || 'salon', 'salon');
    const typeSlug = normalizeSlug(seatType.slug || seatType.nombre || 'mesa', 'mesa');

    let legacyZone = zoneSlug;
    if (zoneSlug === 'barra') {
        legacyZone = 'bar';
    }

    return {
        zona: legacyZone,
        tipo_asiento: typeSlug,
        es_banco: typeSlug === 'banco'
    };
}

async function getActiveDynamicZoneAndType({ zona_id, tipo_puesto_id }) {
    const zoneId = toInteger(zona_id, 0);
    const seatTypeId = toInteger(tipo_puesto_id, 0);

    if (!zoneId || !seatTypeId) {
        return { error: 'Debe seleccionar una zona y un tipo de puesto válidos' };
    }

    const [zone, seatType] = await Promise.all([
        database.get('SELECT * FROM zonas WHERE id = ? AND activa = 1', [zoneId]),
        database.get('SELECT * FROM tipos_puesto WHERE id = ? AND activo = 1', [seatTypeId])
    ]);

    if (!zone) {
        return { error: 'La zona seleccionada no existe o está inactiva' };
    }

    if (!seatType) {
        return { error: 'El tipo de puesto seleccionado no existe o está inactivo' };
    }

    return { zone, seatType };
}

function buildTablesSelect(whereClause = '') {
    return `
        SELECT
            m.*,
            z.id AS zona_dinamica_id,
            z.nombre AS zona_nombre,
            z.slug AS zona_slug,
            z.icono AS zona_icono,
            z.orden AS zona_orden,
            z.acepta_reservas AS zona_acepta_reservas,
            z.aplica_servicio AS zona_aplica_servicio,
            z.porcentaje_servicio AS zona_porcentaje_servicio,
            z.visible_dashboard AS zona_visible_dashboard,
            tp.id AS tipo_puesto_dinamico_id,
            tp.nombre AS tipo_puesto_nombre,
            tp.slug AS tipo_puesto_slug,
            tp.icono AS tipo_puesto_icono,
            CASE
                WHEN m.acepta_reservas_override IS NOT NULL THEN m.acepta_reservas_override
                ELSE COALESCE(z.acepta_reservas, 1)
            END AS acepta_reservas,
            CASE
                WHEN m.aplica_servicio_override IS NOT NULL THEN m.aplica_servicio_override
                ELSE COALESCE(z.aplica_servicio, 0)
            END AS aplica_servicio,
            COALESCE(z.porcentaje_servicio, 10) AS porcentaje_servicio
        FROM mesas m
        LEFT JOIN zonas z ON z.id = m.zona_id
        LEFT JOIN tipos_puesto tp ON tp.id = m.tipo_puesto_id
        ${whereClause}
        ORDER BY
            COALESCE(z.orden, CASE LOWER(COALESCE(m.zona, 'salon')) WHEN 'salon' THEN 1 WHEN 'bar' THEN 2 ELSE 99 END),
            CASE LOWER(COALESCE(tp.slug, m.tipo_asiento, 'mesa')) WHEN 'mesa' THEN 1 WHEN 'banco' THEN 2 ELSE 50 END,
            m.numero ASC
    `;
}

// Obtener todas las mesas/puestos con metadata dinámica compatible
router.get('/', async (req, res) => {
    try {
        const mesas = await database.all(buildTablesSelect('WHERE COALESCE(m.activo, 1) = 1'));
        res.json({ success: true, data: mesas });
    } catch (error) {
        console.error('Error obteniendo Zonas:', error);
        res.status(500).json({ error: 'Error interno del servidor1' });
    }
});

// Obtener estructura dinámica base: zonas y tipos de puesto.
// Esta lectura no cambia la operación actual; prepara futuras fases de Zonas dinámicas.
router.get('/structure', async (req, res) => {
    try {
        const zonas = await database.all(`
            SELECT
                z.*,
                COUNT(m.id) AS puestos_total,
                SUM(CASE WHEN m.estado = 'libre' THEN 1 ELSE 0 END) AS puestos_libres,
                SUM(CASE WHEN m.estado = 'ocupada' THEN 1 ELSE 0 END) AS puestos_ocupados,
                SUM(CASE WHEN m.estado = 'reservada' THEN 1 ELSE 0 END) AS puestos_reservados
            FROM zonas z
            LEFT JOIN mesas m ON m.zona_id = z.id AND COALESCE(m.activo, 1) = 1
            GROUP BY z.id
            ORDER BY z.orden ASC, z.nombre ASC
        `);

        const tiposPuesto = await database.all(`
            SELECT
                tp.*,
                COUNT(m.id) AS puestos_total
            FROM tipos_puesto tp
            LEFT JOIN mesas m ON m.tipo_puesto_id = tp.id AND COALESCE(m.activo, 1) = 1
            GROUP BY tp.id
            ORDER BY tp.orden ASC, tp.nombre ASC
        `);

        const compatibilidad = await database.getDynamicModelCompatibilityReport();

        res.json({
            success: true,
            data: {
                zonas,
                tipos_puesto: tiposPuesto,
                compatibilidad
            }
        });
    } catch (error) {
        console.error('Error obteniendo estructura dinámica de zonas:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Validar compatibilidad entre datos legacy y modelo dinámico.
// No escribe datos: sirve para auditoría operativa antes de activar zonas 100% dinámicas.
router.get('/structure/compatibility', async (req, res) => {
    try {
        const report = await database.getDynamicModelCompatibilityReport();
        res.json({ success: true, data: report });
    } catch (error) {
        console.error('Error validando compatibilidad dinámica de zonas:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});


// Crear zona dinámica del local.
// v2.2.4.5: administración base de estructura, sin activar aún filtros/permisos avanzados por zona.
router.post('/zones', requireAdmin, async (req, res) => {
    try {
        const payload = validateName(req.body?.nombre, 'nombre de la zona');
        if (payload.error) return res.status(400).json({ error: payload.error });

        const slug = normalizeSlug(payload.nombre, 'zona');
        const existing = await database.get('SELECT id FROM zonas WHERE slug = ? OR LOWER(nombre) = LOWER(?)', [slug, payload.nombre]);
        if (existing) {
            return res.status(409).json({ error: 'Ya existe una zona con ese nombre' });
        }

        const result = await database.run(`
            INSERT INTO zonas (
                nombre, slug, icono, color, orden, acepta_reservas,
                aplica_servicio, porcentaje_servicio, visible_dashboard,
                activa, creado_en, actualizado_en
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            payload.nombre,
            slug,
            String(req.body?.icono || 'fa-location-dot').trim() || 'fa-location-dot',
            String(req.body?.color || '#3498db').trim() || '#3498db',
            toInteger(req.body?.orden, 0),
            toBooleanFlag(req.body?.acepta_reservas, true),
            toBooleanFlag(req.body?.aplica_servicio, true),
            toServicePercentage(req.body?.porcentaje_servicio),
            toBooleanFlag(req.body?.visible_dashboard, true),
            toBooleanFlag(req.body?.activa, true),
            new Date().toISOString(),
            new Date().toISOString()
        ]);

        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            ['crear_zona_dinamica', req.session.userId, `Zona dinámica ${payload.nombre} creada`, new Date().toISOString()]
        );

        res.status(201).json({ success: true, data: { id: result.lastID, nombre: payload.nombre, slug } });
    } catch (error) {
        console.error('Error creando zona dinámica:', error);
        res.status(500).json({ error: 'Error interno creando zona' });
    }
});

// Actualizar zona dinámica. No elimina datos ni cambia puestos existentes.
router.put('/zones/:id', requireAdmin, async (req, res) => {
    try {
        const id = toInteger(req.params.id, 0);
        if (!id) return res.status(400).json({ error: 'Zona inválida' });

        const zone = await database.get('SELECT * FROM zonas WHERE id = ?', [id]);
        if (!zone) return res.status(404).json({ error: 'Zona no encontrada' });

        const payload = validateName(req.body?.nombre, 'nombre de la zona');
        if (payload.error) return res.status(400).json({ error: payload.error });

        const duplicate = await database.get('SELECT id FROM zonas WHERE LOWER(nombre) = LOWER(?) AND id != ?', [payload.nombre, id]);
        if (duplicate) {
            return res.status(409).json({ error: 'Ya existe otra zona con ese nombre' });
        }

        const nextActive = toBooleanFlag(req.body?.activa, true);
        if (!nextActive) {
            const activeUse = await database.get(`
                SELECT COUNT(*) AS count
                FROM mesas
                WHERE zona_id = ?
                  AND COALESCE(activo, 1) = 1
                  AND estado IN ('ocupada', 'reservada')
            `, [id]);

            if (Number(activeUse?.count || 0) > 0) {
                return res.status(409).json({ error: 'No se puede desactivar una zona con puestos ocupados o reservados' });
            }
        }

        await database.run(`
            UPDATE zonas
            SET nombre = ?,
                icono = ?,
                color = ?,
                orden = ?,
                acepta_reservas = ?,
                aplica_servicio = ?,
                porcentaje_servicio = ?,
                visible_dashboard = ?,
                activa = ?,
                actualizado_en = ?
            WHERE id = ?
        `, [
            payload.nombre,
            String(req.body?.icono || zone.icono || 'fa-location-dot').trim() || 'fa-location-dot',
            String(req.body?.color || zone.color || '#3498db').trim() || '#3498db',
            toInteger(req.body?.orden, zone.orden || 0),
            toBooleanFlag(req.body?.acepta_reservas, zone.acepta_reservas === 1),
            toBooleanFlag(req.body?.aplica_servicio, zone.aplica_servicio === 1),
            toServicePercentage(req.body?.porcentaje_servicio ?? zone.porcentaje_servicio),
            toBooleanFlag(req.body?.visible_dashboard, zone.visible_dashboard === 1),
            nextActive,
            new Date().toISOString(),
            id
        ]);

        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            ['actualizar_zona_dinamica', req.session.userId, `Zona dinámica ${payload.nombre} actualizada`, new Date().toISOString()]
        );

        res.json({ success: true, message: 'Zona actualizada correctamente' });
    } catch (error) {
        console.error('Error actualizando zona dinámica:', error);
        res.status(500).json({ error: 'Error interno actualizando zona' });
    }
});

// Crear tipo de puesto dinámico.
router.post('/seat-types', requireAdmin, async (req, res) => {
    try {
        const payload = validateName(req.body?.nombre, 'nombre del tipo de puesto');
        if (payload.error) return res.status(400).json({ error: payload.error });

        const slug = normalizeSlug(payload.nombre, 'puesto');
        const existing = await database.get('SELECT id FROM tipos_puesto WHERE slug = ? OR LOWER(nombre) = LOWER(?)', [slug, payload.nombre]);
        if (existing) {
            return res.status(409).json({ error: 'Ya existe un tipo de puesto con ese nombre' });
        }

        const result = await database.run(`
            INSERT INTO tipos_puesto (nombre, slug, icono, orden, activo, creado_en, actualizado_en)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
            payload.nombre,
            slug,
            String(req.body?.icono || 'fa-chair').trim() || 'fa-chair',
            toInteger(req.body?.orden, 0),
            toBooleanFlag(req.body?.activo, true),
            new Date().toISOString(),
            new Date().toISOString()
        ]);

        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            ['crear_tipo_puesto', req.session.userId, `Tipo de puesto ${payload.nombre} creado`, new Date().toISOString()]
        );

        res.status(201).json({ success: true, data: { id: result.lastID, nombre: payload.nombre, slug } });
    } catch (error) {
        console.error('Error creando tipo de puesto:', error);
        res.status(500).json({ error: 'Error interno creando tipo de puesto' });
    }
});

// Actualizar tipo de puesto dinámico.
router.put('/seat-types/:id', requireAdmin, async (req, res) => {
    try {
        const id = toInteger(req.params.id, 0);
        if (!id) return res.status(400).json({ error: 'Tipo de puesto inválido' });

        const seatType = await database.get('SELECT * FROM tipos_puesto WHERE id = ?', [id]);
        if (!seatType) return res.status(404).json({ error: 'Tipo de puesto no encontrado' });

        const payload = validateName(req.body?.nombre, 'nombre del tipo de puesto');
        if (payload.error) return res.status(400).json({ error: payload.error });

        const duplicate = await database.get('SELECT id FROM tipos_puesto WHERE LOWER(nombre) = LOWER(?) AND id != ?', [payload.nombre, id]);
        if (duplicate) {
            return res.status(409).json({ error: 'Ya existe otro tipo de puesto con ese nombre' });
        }

        const nextActive = toBooleanFlag(req.body?.activo, true);
        if (!nextActive) {
            const linkedSeats = await database.get('SELECT COUNT(*) AS count FROM mesas WHERE tipo_puesto_id = ? AND COALESCE(activo, 1) = 1', [id]);
            if (Number(linkedSeats?.count || 0) > 0) {
                return res.status(409).json({ error: 'No se puede desactivar un tipo de puesto que tiene puestos activos' });
            }
        }

        await database.run(`
            UPDATE tipos_puesto
            SET nombre = ?,
                icono = ?,
                orden = ?,
                activo = ?,
                actualizado_en = ?
            WHERE id = ?
        `, [
            payload.nombre,
            String(req.body?.icono || seatType.icono || 'fa-chair').trim() || 'fa-chair',
            toInteger(req.body?.orden, seatType.orden || 0),
            nextActive,
            new Date().toISOString(),
            id
        ]);

        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            ['actualizar_tipo_puesto', req.session.userId, `Tipo de puesto ${payload.nombre} actualizado`, new Date().toISOString()]
        );

        res.json({ success: true, message: 'Tipo de puesto actualizado correctamente' });
    } catch (error) {
        console.error('Error actualizando tipo de puesto:', error);
        res.status(500).json({ error: 'Error interno actualizando tipo de puesto' });
    }
});

// Crear nuevo puesto compatible con el modelo dinámico.
// Mantiene compatibilidad con payload legacy: tipo_zona/tipo_asiento.
router.post('/', requireAdmin, async (req, res) => {
    try {
        let {
            tipo_zona,
            tipo_asiento,
            zona_id,
            tipo_puesto_id,
            numero,
            capacidad,
            nombre_visible,
            acepta_reservas_override,
            aplica_servicio_override
        } = req.body;

        numero = toInteger(numero, 0);
        capacidad = toInteger(capacidad, 0);

        let dynamicLinks;
        let zone;
        let seatType;
        let legacyValues;

        if (zona_id || tipo_puesto_id) {
            dynamicLinks = await getActiveDynamicZoneAndType({ zona_id, tipo_puesto_id });
            if (dynamicLinks.error) {
                return res.status(400).json({ error: dynamicLinks.error });
            }

            zone = dynamicLinks.zone;
            seatType = dynamicLinks.seatType;
            legacyValues = buildLegacySeatValuesFromDynamic(zone, seatType);
            tipo_zona = legacyValues.zona;
            tipo_asiento = legacyValues.tipo_asiento;
            zona_id = zone.id;
            tipo_puesto_id = seatType.id;
        } else {
            if (!tipo_zona || !numero || !capacidad) {
                return res.status(400).json({ error: 'Faltan datos obligatorios (tipo_zona, numero o capacidad)' });
            }

            tipo_zona = String(tipo_zona).toLowerCase();

            if (!['salon', 'bar'].includes(tipo_zona)) {
                return res.status(400).json({ error: 'Zona inválida' });
            }

            if (tipo_zona === 'salon') {
                tipo_asiento = 'mesa';
            }

            if (tipo_zona === 'bar') {
                if (!tipo_asiento || !['mesa', 'banco'].includes(String(tipo_asiento).toLowerCase())) {
                    return res.status(400).json({ error: 'Tipo de asiento inválido para zona bar' });
                }
                tipo_asiento = String(tipo_asiento).toLowerCase();
            }

            dynamicLinks = await getDynamicZoneAndTypeIds({ zona: tipo_zona, tipo_asiento });
            zona_id = dynamicLinks.zona_id;
            tipo_puesto_id = dynamicLinks.tipo_puesto_id;
        }

        if (!numero || numero < 1) {
            return res.status(400).json({ error: 'El número del puesto debe ser mayor a 0' });
        }

        if (String(tipo_asiento).toLowerCase() === 'banco') {
            capacidad = 1;
        }

        if (!capacidad || capacidad < 1 || capacidad > 99) {
            return res.status(400).json({ error: 'La capacidad debe estar entre 1 y 99 personas' });
        }

        if (!zona_id || !tipo_puesto_id) {
            return res.status(409).json({
                error: 'La estructura dinámica de zonas/puestos no está lista. Reinicie la app o revise la compatibilidad del modelo.'
            });
        }

        const existenteDinamico = await database.get(
            'SELECT id FROM mesas WHERE numero = ? AND zona_id = ? AND tipo_puesto_id = ? AND COALESCE(activo, 1) = 1',
            [numero, zona_id, tipo_puesto_id]
        );

        if (existenteDinamico) {
            return res.status(400).json({ error: 'Ya existe un puesto con ese número en esa zona y tipo' });
        }

        const existenteLegacy = await database.get(
            'SELECT id FROM mesas WHERE numero = ? AND zona = ? AND tipo_asiento = ? AND COALESCE(activo, 1) = 1',
            [numero, tipo_zona, tipo_asiento]
        );

        if (existenteLegacy) {
            return res.status(400).json({ error: 'Ya existe una mesa/banco con ese número en esa zona' });
        }

        const result = await database.run(
            `INSERT INTO mesas (
                numero, capacidad, estado, zona, tipo_asiento,
                zona_id, tipo_puesto_id, nombre_visible,
                acepta_reservas_override, aplica_servicio_override, activo
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                numero,
                capacidad,
                'libre',
                tipo_zona,
                tipo_asiento,
                zona_id,
                tipo_puesto_id,
                String(nombre_visible || '').trim() || null,
                toOptionalOverride(acepta_reservas_override),
                toOptionalOverride(aplica_servicio_override),
                1
            ]
        );

        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            ['crear_puesto', req.session.userId, `Puesto ${tipo_asiento} ${numero} creado`, new Date().toISOString()]
        );

        return res.status(201).json({
            success: true,
            data: {
                id: result.lastID,
                numero,
                capacidad,
                zona: tipo_zona,
                tipo_asiento,
                zona_id,
                tipo_puesto_id,
                estado: 'libre'
            }
        });
    } catch (error) {
        console.error('❌ Error al crear puesto:', error.message, error.stack);
        return res.status(500).json({ error: 'Error interno del servidor2' });
    }
});



// Actualizar mesa
router.put('/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        let { capacidad } = req.body;

        if (!capacidad) {
            return res.status(400).json({ error: 'La capacidad es requerida' });
        }

        capacidad = parseInt(capacidad);

        // Verificar que la mesa existe
        const mesa = await database.get('SELECT * FROM mesas WHERE id = ?', [id]);
        if (!mesa) {
            return res.status(404).json({ error: 'Mesa no encontrada' });
        }

        const esBanco = mesa.zona?.toLowerCase() === 'bar' && mesa.tipo_asiento?.toLowerCase() === 'banco';
        const tipoNombre = esBanco ? 'banco' : 'mesa';
        const tipoCapitalizado = tipoNombre.charAt(0).toUpperCase() + tipoNombre.slice(1);
        const verbo = tipoNombre === 'banco' ? 'actualizado' : 'actualizada';

        // Proteger banco: capacidad fija en 1
        if (esBanco && capacidad !== 1) {
            return res.status(400).json({ error: 'La capacidad de un banco no puede modificarse' });
        }

        // Actualizar capacidad
        await database.run(
            'UPDATE mesas SET capacidad = ? WHERE id = ?',
            [capacidad, id]
        );

        // Registrar en historial
        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            [
                `actualizar_${tipoNombre}`,
                req.session.userId,
                `Capacidad de ${tipoNombre} ${mesa.numero} actualizada`,
                new Date().toISOString()
            ]
        );

        res.json({ success: true, message: `${tipoCapitalizado} ${verbo} exitosamente` });

    } catch (error) {
        console.error('Error actualizando capacidad:', error);
        res.status(500).json({ error: 'Error actualizando capacidad' });
    }
});

// Eliminar mesa
router.delete('/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        // Obtener la mesa
        const mesa = await database.get('SELECT * FROM mesas WHERE id = ?', [id]);
        if (!mesa) {
            return res.status(404).json({ error: 'Zona no encontrada' });
        }

        const tipoNombre = mesa.zona?.toLowerCase() === 'bar' && mesa.tipo_asiento?.toLowerCase() === 'banco'
            ? 'banco'
            : 'mesa';

        // Verificar que no esté ocupada
        if (mesa.estado === 'ocupada') {
            return res.status(400).json({ error: `No se puede eliminar un ${tipoNombre} ocupado` });
        }

        // Verificar que no tenga pedidos pendientes
        const pedidosPendientes = await database.get(
            'SELECT COUNT(*) as count FROM pedidos WHERE mesa_id = ? AND estado = ?',
            [id, 'pendiente']
        );
        if (pedidosPendientes.count > 0) {
            return res.status(400).json({ error: `No se puede eliminar un ${tipoNombre} con pedidos pendientes` });
        }

        // ❗ Verificar si es el último (mayor número) dentro de su zona y tipo_asiento
        const result = await database.get(
            'SELECT MAX(numero) AS maxNumero FROM mesas WHERE zona = ? AND tipo_asiento = ?',
            [mesa.zona, mesa.tipo_asiento]
        );

        if (mesa.numero !== result.maxNumero) {
            return res.status(400).json({ error: `Solo se puede eliminar el ${tipoNombre} con el número más alto (${result.maxNumero})` });
        }

        // Eliminar mesa
        await database.run('DELETE FROM mesas WHERE id = ?', [id]);

        // Registrar historial
        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            ['eliminar_mesa', req.session.userId, `Eliminado ${tipoNombre} ${mesa.numero}`, new Date().toISOString()]
        );

        res.json({
            success: true,
            message: `${tipoNombre.charAt(0).toUpperCase() + tipoNombre.slice(1)} eliminado correctamente`
        });

    } catch (error) {
        console.error('Error eliminando mesa:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Abrir mesa (asignar cliente o reservar)
router.post('/:id/open', async (req, res) => {
    try {
        const { id } = req.params;
        const { cliente_nombre, estado, cantidad_personas, hora_estimada } = req.body;

        if (!cliente_nombre || !estado || !cantidad_personas) {
            return res.status(400).json({ error: 'Nombre del cliente, estado y cantidad de personas son requeridos' });
        }

        // Verificar que la mesa existe y está libre
        const mesa = await database.get('SELECT * FROM mesas WHERE id = ?', [id]);
        if (!mesa) {
            return res.status(404).json({ error: 'Mesa no encontrada' });
        }

        const esBanco = mesa.zona?.toLowerCase() === 'bar' && mesa.tipo_asiento?.toLowerCase() === 'banco';
        const tipoNombre = esBanco ? 'banco' : 'mesa';

        if (mesa.estado !== 'libre') {
            return res.status(400).json({ error: `El ${tipoNombre} no está disponible` });
        }

        let query;
        let params;
        let descripcionAccion;

        if (estado === 'reservada') {
            if (esBanco) {
                return res.status(400).json({ error: 'No se puede reservar un banco' });
            }

            query = `
                UPDATE mesas 
                SET estado = ?, cliente_nombre = ?, cantidad_personas = ?, hora_estimada = ? 
                WHERE id = ?
            `;
            params = [estado, cliente_nombre, cantidad_personas, hora_estimada, id];
            descripcionAccion = `${tipoNombre.charAt(0).toUpperCase() + tipoNombre.slice(1)} ${mesa.numero} reservada por ${cliente_nombre} para ${cantidad_personas} personas a las ${hora_estimada}`;
        } else if (estado === 'ocupada') {
            const personas = esBanco ? 1 : cantidad_personas;
            query = `
                UPDATE mesas 
                SET estado = ?, cliente_nombre = ?, fecha_apertura = ?, cantidad_personas = ? 
                WHERE id = ?
            `;
            params = [estado, cliente_nombre, new Date().toISOString(), personas, id];
            descripcionAccion = `${tipoNombre.charAt(0).toUpperCase() + tipoNombre.slice(1)} ${mesa.numero} abierta para ${cliente_nombre} con ${personas} personas`;
        } else {
            return res.status(400).json({ error: `Estado de ${tipoNombre} no válido` });
        }

        await database.run(query, params);

        // Registrar en historial
        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            [
                estado === 'reservada' ? `reservar_${tipoNombre}` : `abrir_${tipoNombre}`,
                req.session.userId,
                descripcionAccion,
                new Date().toISOString()
            ]
        );

        res.json({
            success: true,
            message: `${tipoNombre.charAt(0).toUpperCase() + tipoNombre.slice(1)} ${estado === 'reservada' ? 'reservado' : 'abierto'} exitosamente`
        });

    } catch (error) {
        console.error('Error abriendo/reservando zona:', error);
        res.status(500).json({ error: 'Error interno del servidor4' });
    }
});

// Cerrar mesa (liberar)
router.post('/:id/close', async (req, res) => {
    try {
        const { id } = req.params;

        // Verificar que la mesa existe
        const mesa = await database.get('SELECT * FROM mesas WHERE id = ?', [id]);
        if (!mesa) {
            return res.status(404).json({ error: 'Mesa no encontrada' });
        }

        const esBanco = mesa.zona?.toLowerCase() === 'bar' && mesa.tipo_asiento?.toLowerCase() === 'banco';
        const tipoNombre = esBanco ? 'banco' : 'mesa';
        const tipoCapitalizado = tipoNombre.charAt(0).toUpperCase() + tipoNombre.slice(1);

        // Verificar pedidos pendientes solo si está ocupada
        if (mesa.estado === 'ocupada') {
            const pedidosPendientes = await database.get(
                'SELECT COUNT(*) as count FROM pedidos WHERE mesa_id = ? AND estado = ?',
                [id, 'pendiente']
            );

            if (pedidosPendientes.count > 0) {
                return res.status(400).json({ error: `No se puede cerrar un ${tipoNombre} con pedidos pendientes` });
            }
        }

        // Liberar mesa
        await database.run(
            `UPDATE mesas 
             SET estado = ?, cliente_nombre = NULL, fecha_apertura = NULL, 
                 cantidad_personas = NULL, hora_estimada = NULL 
             WHERE id = ?`,
            ['libre', id]
        );

        // Registrar en historial
        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            [
                `cerrar_${tipoNombre}`,
                req.session.userId,
                `${tipoCapitalizado} ${mesa.numero} cerrada`,
                new Date().toISOString()
            ]
        );

        res.json({
            success: true,
            message: `${tipoCapitalizado} cerrada exitosamente`
        });

    } catch (error) {
        console.error('Error cerrando zona:', error);
        res.status(500).json({ error: 'Error interno del servidor5' });
    }
});

// Cambiar mesa de reservada a ocupada
router.post('/:id/change-to-occupied', async (req, res) => {
    try {
        const { id } = req.params;

        // Verificar que la mesa existe y está reservada
        const mesa = await database.get('SELECT * FROM mesas WHERE id = ?', [id]);
        if (!mesa) {
            return res.status(404).json({ error: 'Mesa no encontrada' });
        }

        const esBanco = mesa.zona?.toLowerCase() === 'bar' && mesa.tipo_asiento?.toLowerCase() === 'banco';
        const tipoNombre = esBanco ? 'banco' : 'mesa';
        const tipoCapitalizado = tipoNombre.charAt(0).toUpperCase() + tipoNombre.slice(1);

        if (esBanco) {
            return res.status(400).json({ error: 'Un banco no puede estar reservado ni cambiar a ocupada desde una reserva' });
        }

        if (mesa.estado !== 'reservada') {
            return res.status(400).json({ error: `El ${tipoNombre} no está reservado` });
        }

        await database.run(
            'UPDATE mesas SET estado = ?, fecha_apertura = ? WHERE id = ?',
            ['ocupada', new Date().toISOString(), id]
        );

        // Registrar en historial
        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            [
                'cambiar_estado_mesa',
                req.session.userId,
                `${tipoCapitalizado} ${mesa.numero} cambió de reservada a ocupada`,
                new Date().toISOString()
            ]
        );

        res.json({ success: true, message: `${tipoCapitalizado} cambiada a ocupada exitosamente` });

    } catch (error) {
        console.error('Error cambiando estado de mesa:', error);
        res.status(500).json({ error: 'Error interno del servidor6' });
    }
});

// Obtener el siguiente número disponible por zona/tipo dinámico o por compatibilidad legacy.
router.get('/next-numero', async (req, res) => {
    try {
        let { zona, tipo_asiento, zona_id, tipo_puesto_id } = req.query;

        if (zona_id || tipo_puesto_id) {
            const dynamicLinks = await getActiveDynamicZoneAndType({ zona_id, tipo_puesto_id });
            if (dynamicLinks.error) {
                return res.status(400).json({ error: dynamicLinks.error });
            }

            const result = await database.get(
                'SELECT MAX(numero) AS maxNumero FROM mesas WHERE zona_id = ? AND tipo_puesto_id = ? AND COALESCE(activo, 1) = 1',
                [dynamicLinks.zone.id, dynamicLinks.seatType.id]
            );

            return res.json({ numero: (result?.maxNumero || 0) + 1 });
        }

        if (!zona) {
            return res.status(400).json({ error: 'Zona requerida' });
        }

        zona = zona.toLowerCase();

        // Asignar tipo_asiento según zona
        if (zona === 'salon') {
            tipo_asiento = 'mesa';
        } else if (zona === 'bar') {
            if (!tipo_asiento) {
                return res.status(400).json({ error: 'Tipo de asiento requerido para zona bar' });
            }
            tipo_asiento = tipo_asiento.toLowerCase();
            if (!['mesa', 'banco'].includes(tipo_asiento)) {
                return res.status(400).json({ error: 'Tipo de asiento inválido' });
            }
        } else {
            return res.status(400).json({ error: 'Zona inválida' });
        }

        const result = await database.get(
            'SELECT MAX(numero) AS maxNumero FROM mesas WHERE zona = ? AND tipo_asiento = ? AND COALESCE(activo, 1) = 1',
            [zona, tipo_asiento]
        );

        const siguienteNumero = (result?.maxNumero || 0) + 1;

        res.json({ numero: siguienteNumero });

    } catch (error) {
        console.error('❌ Error en /next-numero:', error);
        res.status(500).json({ error: 'Error interno del servidor7' });
    }
});

// Obtener una mesa específica
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const mesa = await database.get(buildTablesSelect('WHERE m.id = ?'), [id]);
        
        if (!mesa) {
            return res.status(404).json({ error: 'Zona no encontrada' });
        }

        res.json({ success: true, data: mesa });
    } catch (error) {
        console.error('Error obteniendo Zona:', error);
        res.status(500).json({ error: 'Error interno del servidor8' });
    }
});

module.exports = router;




