const express = require('express');
const database = require('../db/database');

const router = express.Router();

// Obtener todas las mesas
router.get('/', async (req, res) => {
    
    try {
        const mesas = await database.all('SELECT * FROM mesas ORDER BY numero');
        res.json({ success: true, data: mesas });
    } catch (error) {
        console.error('Error obteniendo Zonas:', error);
        res.status(500).json({ error: 'Error interno del servidor1' });
    }
});

// Crear nueva mesa o banco
router.post('/', async (req, res) => {
    try {
        let { tipo_zona, tipo_asiento, numero, capacidad } = req.body;

        if (!tipo_zona || !numero || !capacidad) {
            return res.status(400).json({ error: 'Faltan datos obligatorios (tipo_zona, numero o capacidad)' });
        }

        tipo_zona = tipo_zona.toLowerCase();

        if (!['salon', 'bar'].includes(tipo_zona)) {
            return res.status(400).json({ error: 'Zona inválida' });
        }

        if (tipo_zona === 'salon') {
            tipo_asiento = 'mesa';
        }

        if (tipo_zona === 'bar') {
            if (!tipo_asiento || !['mesa', 'banco'].includes(tipo_asiento.toLowerCase())) {
                return res.status(400).json({ error: 'Tipo de asiento inválido para zona bar' });
            }
            tipo_asiento = tipo_asiento.toLowerCase();
        }

        if (tipo_zona === 'bar' && tipo_asiento === 'banco') {
            capacidad = 1;
        }

        // Validación final antes del insert
        if (!numero || !capacidad || !tipo_zona || !tipo_asiento) {
            console.error('❌ Datos faltantes:', { numero, capacidad, tipo_zona, tipo_asiento });
            return res.status(400).json({ error: 'Datos incompletos al crear zona' });
        }

        const existente = await database.get(
            'SELECT id FROM mesas WHERE numero = ? AND zona = ? AND tipo_asiento = ?',
            [numero, tipo_zona, tipo_asiento]
        );

        if (existente) {
            return res.status(400).json({ error: 'Ya existe una mesa/banco con ese número en esa zona' });
        }

        const result = await database.run(
            'INSERT INTO mesas (numero, capacidad, estado, zona, tipo_asiento) VALUES (?, ?, ?, ?, ?)',
            [numero, capacidad, 'libre', tipo_zona, tipo_asiento]
        );

        return res.status(201).json({
            success: true,
            data: {
                id: result.lastID,
                numero,
                capacidad,
                zona: tipo_zona,
                tipo_asiento,
                estado: 'libre'
            }
        });
    } catch (error) {
        console.error('❌ Error al crear mesa/banco:', error.message, error.stack);
        return res.status(500).json({ error: 'Error interno del servidor2' });
    }
});



// Actualizar mesa
router.put('/:id', async (req, res) => {
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
router.delete('/:id', async (req, res) => {
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

// Obtener el siguiente número disponible por zona y tipo de asiento
router.get('/next-numero', async (req, res) => {
    try {
        let { zona, tipo_asiento } = req.query;

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
            'SELECT MAX(numero) AS maxNumero FROM mesas WHERE zona = ? AND tipo_asiento = ?',
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
        const mesa = await database.get('SELECT * FROM mesas WHERE id = ?', [id]);
        
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




