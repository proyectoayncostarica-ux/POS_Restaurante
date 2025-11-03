const express = require('express');
const database = require('../db/database');

const router = express.Router();

// Obtener todas las cuentas de crédito
router.get('/', async (req, res) => {
    try {
        const cuentas = await database.all(`
            SELECT * FROM cuentas_credito 
            ORDER BY fecha DESC
        `);
        
        res.json({ success: true, data: cuentas });
    } catch (error) {
        console.error('Error obteniendo cuentas de crédito:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Obtener una cuenta de crédito específica
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const cuenta = await database.get('SELECT * FROM cuentas_credito WHERE id = ?', [id]);
        
        if (!cuenta) {
            return res.status(404).json({ error: 'Cuenta de crédito no encontrada' });
        }

        res.json({ success: true, data: cuenta });
    } catch (error) {
        console.error('Error obteniendo cuenta de crédito:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Crear nueva cuenta de crédito
router.post('/', async (req, res) => {
    try {
        const { cliente_nombre, monto_total } = req.body;

        if (!cliente_nombre || !monto_total) {
            return res.status(400).json({ error: 'Nombre del cliente y monto son requeridos' });
        }

        if (monto_total <= 0) {
            return res.status(400).json({ error: 'El monto debe ser mayor a cero' });
        }

        const result = await database.run(
            'INSERT INTO cuentas_credito (cliente_nombre, monto_total, fecha) VALUES (?, ?, ?)',
            [cliente_nombre, monto_total, new Date().toISOString()]
        );

        // Registrar en historial
        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            ['crear_cuenta_credito', req.session.userId, `Cuenta de crédito creada para ${cliente_nombre} - ₡${monto_total}`, new Date().toISOString()]
        );

        res.json({ 
            success: true, 
            data: { 
                id: result.id, 
                cliente_nombre, 
                monto_total, 
                fecha: new Date().toISOString() 
            } 
        });
    } catch (error) {
        console.error('Error creando cuenta de crédito:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Pagar cuenta de crédito completa
router.post('/:id/pay', async (req, res) => {
    try {
        const { id } = req.params;
        const { metodo_pago } = req.body;

        if (!metodo_pago) {
            return res.status(400).json({ error: 'Método de pago es requerido' });
        }

        // Verificar que la cuenta existe
        const cuenta = await database.get('SELECT * FROM cuentas_credito WHERE id = ?', [id]);
        if (!cuenta) {
            return res.status(404).json({ error: 'Cuenta de crédito no encontrada' });
        }

        // Registrar el pago en la tabla de pagos_creditos
        await database.run(
            'INSERT INTO pagos_creditos (credito_id, cliente_nombre, monto_pagado, monto_original, es_pago_completo, metodo_pago, fecha_pago, usuario_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [id, cuenta.cliente_nombre, cuenta.monto_total, cuenta.monto_total, 1, metodo_pago, new Date().toISOString(), req.session.userId]
        );

        // Eliminar la cuenta (pago completo) - esto suma automáticamente a las ventas del día
        await database.run('DELETE FROM cuentas_credito WHERE id = ?', [id]);

        // Registrar el pago en historial
        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            ['pago_completo_credito', req.session.userId, `Pago completo de ₡${cuenta.monto_total} para ${cuenta.cliente_nombre} (${metodo_pago})`, new Date().toISOString()]
        );

        res.json({ 
            success: true, 
            data: { 
                monto_pagado: cuenta.monto_total,
                cliente_nombre: cuenta.cliente_nombre,
                metodo_pago,
                fecha_pago: new Date().toISOString()
            } 
        });
    } catch (error) {
        console.error('Error procesando pago de crédito:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Abonar a una cuenta de crédito
router.post('/:id/payment', async (req, res) => {
    try {
        const { id } = req.params;
        const { monto_abono, metodo_pago } = req.body;

        if (!monto_abono || !metodo_pago) {
            return res.status(400).json({ error: 'Monto de abono y método de pago son requeridos' });
        }

        if (monto_abono <= 0) {
            return res.status(400).json({ error: 'El monto de abono debe ser mayor a cero' });
        }

        // Verificar que la cuenta existe
        const cuenta = await database.get('SELECT * FROM cuentas_credito WHERE id = ?', [id]);
        if (!cuenta) {
            return res.status(404).json({ error: 'Cuenta de crédito no encontrada' });
        }

        if (monto_abono > cuenta.monto_total) {
            return res.status(400).json({ error: 'El abono no puede ser mayor al monto pendiente' });
        }

        const nuevoMonto = cuenta.monto_total - monto_abono;
        const esPagoCompleto = nuevoMonto === 0;

        // Registrar el pago en la tabla de pagos_creditos
        await database.run(
            'INSERT INTO pagos_creditos (credito_id, cliente_nombre, monto_pagado, monto_original, es_pago_completo, metodo_pago, fecha_pago, usuario_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [id, cuenta.cliente_nombre, monto_abono, cuenta.monto_total, esPagoCompleto ? 1 : 0, metodo_pago, new Date().toISOString(), req.session.userId]
        );

        // Si el abono cubre toda la deuda, eliminar la cuenta
        if (esPagoCompleto) {
            await database.run('DELETE FROM cuentas_credito WHERE id = ?', [id]);
        } else {
            // Actualizar el monto pendiente
            await database.run(
                'UPDATE cuentas_credito SET monto_total = ? WHERE id = ?',
                [nuevoMonto, id]
            );
        }

        // Registrar el pago en historial
        const tipoAccion = esPagoCompleto ? 'pago_completo_credito' : 'abono_cuenta_credito';
        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            [tipoAccion, req.session.userId, `Abono de ₡${monto_abono} a cuenta de ${cuenta.cliente_nombre} (${metodo_pago})`, new Date().toISOString()]
        );

        res.json({ 
            success: true, 
            data: { 
                monto_abonado: monto_abono,
                monto_restante: nuevoMonto,
                cuenta_saldada: esPagoCompleto,
                metodo_pago
            } 
        });
    } catch (error) {
        console.error('Error procesando abono:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Eliminar cuenta de crédito (solo administradores)
router.delete('/:id', async (req, res) => {
    try {
        // Verificar permisos de administrador
        if (req.session.userType !== 'administrador') {
            return res.status(403).json({ error: 'Solo los administradores pueden eliminar cuentas de crédito' });
        }

        const { id } = req.params;

        // Verificar que la cuenta existe
        const cuenta = await database.get('SELECT * FROM cuentas_credito WHERE id = ?', [id]);
        if (!cuenta) {
            return res.status(404).json({ error: 'Cuenta de crédito no encontrada' });
        }

        await database.run('DELETE FROM cuentas_credito WHERE id = ?', [id]);

        // Registrar en historial
        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            ['eliminar_cuenta_credito', req.session.userId, `Cuenta de crédito eliminada para ${cuenta.cliente_nombre}`, new Date().toISOString()]
        );

        res.json({ success: true, message: 'Cuenta de crédito eliminada exitosamente' });
    } catch (error) {
        console.error('Error eliminando cuenta de crédito:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Obtener resumen de cuentas de crédito
router.get('/summary/stats', async (req, res) => {
    try {
        const totalCuentas = await database.get('SELECT COUNT(*) as count FROM cuentas_credito');
        const montoTotal = await database.get('SELECT COALESCE(SUM(monto_total), 0) as total FROM cuentas_credito');
        
        const cuentasPorCliente = await database.all(`
            SELECT cliente_nombre, COUNT(*) as num_cuentas, SUM(monto_total) as monto_total
            FROM cuentas_credito
            GROUP BY cliente_nombre
            ORDER BY monto_total DESC
        `);

        res.json({ 
            success: true, 
            data: {
                total_cuentas: totalCuentas.count,
                monto_total_pendiente: montoTotal.total,
                cuentas_por_cliente: cuentasPorCliente
            }
        });
    } catch (error) {
        console.error('Error obteniendo resumen de cuentas:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

module.exports = router;

