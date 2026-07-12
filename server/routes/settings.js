const express = require('express');
const database = require('../db/database');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const router = express.Router();

// Configuración de multer para subida de archivos
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = path.join(__dirname, '../../public/uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'logo-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB
    },
    fileFilter: function (req, file, cb) {
        const allowedTypes = /jpeg|jpg|png|gif/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);

        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Solo se permiten imágenes (JPEG, JPG, PNG, GIF)'));
        }
    }
});

// Middleware para verificar permisos de administrador
const requireAdmin = (req, res, next) => {
    if (req.session.userType !== 'administrador') {
        return res.status(403).json({ error: 'Solo los administradores pueden acceder a la configuración' });
    }
    next();
};

// Obtener toda la configuración
router.get('/', requireAdmin, async (req, res) => {
    try {
        const configuraciones = await database.all('SELECT * FROM configuracion');
        
        // Convertir array a objeto para facilitar el uso
        const config = {};
        configuraciones.forEach(item => {
            config[item.clave] = item.valor;
        });

        res.json({ success: true, data: config });
    } catch (error) {
        console.error('Error obteniendo configuración:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Obtener una configuración específica
router.get('/:key', async (req, res) => {
    try {
        const { key } = req.params;
        const config = await database.get('SELECT * FROM configuracion WHERE clave = ?', [key]);
        
        if (!config) {
            return res.status(404).json({ error: 'Configuración no encontrada' });
        }

        res.json({ success: true, data: config });
    } catch (error) {
        console.error('Error obteniendo configuración:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Actualizar configuración
router.put('/', requireAdmin, async (req, res) => {
    try {
        const configuraciones = req.body;

        if (!configuraciones || typeof configuraciones !== 'object') {
            return res.status(400).json({ error: 'Configuraciones inválidas' });
        }

        // Actualizar cada configuración
        for (const [clave, valor] of Object.entries(configuraciones)) {
            await database.run(
                'INSERT OR REPLACE INTO configuracion (clave, valor) VALUES (?, ?)',
                [clave, valor]
            );
        }

        // Registrar en historial
        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            ['actualizar_configuracion', req.session.userId, `Configuración del sistema actualizada`, new Date().toISOString()]
        );

        res.json({ success: true, message: 'Configuración actualizada exitosamente' });
    } catch (error) {
        console.error('Error actualizando configuración:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Subir logo del restaurante
router.post('/upload-logo', requireAdmin, upload.single('logo'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No se proporcionó archivo de logo' });
        }

        const logoPath = `/uploads/${req.file.filename}`;

        // Guardar ruta del logo en configuración
        await database.run(
            'INSERT OR REPLACE INTO configuracion (clave, valor) VALUES (?, ?)',
            ['logo_path', logoPath]
        );

        // Registrar en historial
        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            ['subir_logo', req.session.userId, `Logo del restaurante actualizado`, new Date().toISOString()]
        );

        res.json({ 
            success: true, 
            data: { 
                logo_path: logoPath,
                filename: req.file.filename
            } 
        });
    } catch (error) {
        console.error('Error subiendo logo:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Obtener historial de transacciones
router.get('/history/transactions', requireAdmin, async (req, res) => {
    try {
        const { limit = 50, offset = 0, tipo_accion, usuario_id } = req.query;

        let whereClause = '';
        let params = [];

        if (tipo_accion) {
            whereClause += ' WHERE h.tipo_accion = ?';
            params.push(tipo_accion);
        }

        if (usuario_id) {
            whereClause += tipo_accion ? ' AND h.usuario_id = ?' : ' WHERE h.usuario_id = ?';
            params.push(usuario_id);
        }

        const historial = await database.all(`
            SELECT h.*, u.nombre as usuario_nombre
            FROM historial_transacciones h
            LEFT JOIN usuarios u ON h.usuario_id = u.id
            ${whereClause}
            ORDER BY h.fecha DESC
            LIMIT ? OFFSET ?
        `, [...params, parseInt(limit), parseInt(offset)]);

        const total = await database.get(`
            SELECT COUNT(*) as count
            FROM historial_transacciones h
            ${whereClause}
        `, params);

        res.json({ 
            success: true, 
            data: {
                historial,
                total: total.count,
                limit: parseInt(limit),
                offset: parseInt(offset)
            }
        });
    } catch (error) {
        console.error('Error obteniendo historial:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Limpiar historial antiguo
router.delete('/history/cleanup', requireAdmin, async (req, res) => {
    try {
        const { days = 30 } = req.body;

        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);

        const result = await database.run(
            'DELETE FROM historial_transacciones WHERE fecha < ?',
            [cutoffDate.toISOString()]
        );

        // Registrar en historial
        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            ['limpiar_historial', req.session.userId, `Historial limpiado - ${result.changes} registros eliminados`, new Date().toISOString()]
        );

        res.json({ 
            success: true, 
            data: { 
                registros_eliminados: result.changes,
                dias_antiguedad: days
            } 
        });
    } catch (error) {
        console.error('Error limpiando historial:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Crear respaldo de la base de datos
router.post('/backup/create', requireAdmin, async (req, res) => {
    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupName = `backup-${timestamp}.db`;
        const backupPath = path.join(__dirname, '../../data/backups');
        
        // Crear directorio de respaldos si no existe
        if (!fs.existsSync(backupPath)) {
            fs.mkdirSync(backupPath, { recursive: true });
        }

        const fullBackupPath = path.join(backupPath, backupName);
        const sourcePath = path.join(__dirname, '../../data/restaurant.db');

        // Copiar archivo de base de datos
        fs.copyFileSync(sourcePath, fullBackupPath);

        // Registrar respaldo en la base de datos
        await database.run(
            'INSERT INTO respaldos (nombre_archivo, ruta, fecha_creacion) VALUES (?, ?, ?)',
            [backupName, fullBackupPath, new Date().toISOString()]
        );

        // Registrar en historial
        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            ['crear_respaldo', req.session.userId, `Respaldo creado: ${backupName}`, new Date().toISOString()]
        );

        res.json({ 
            success: true, 
            data: { 
                backup_name: backupName,
                backup_path: fullBackupPath,
                size: fs.statSync(fullBackupPath).size
            } 
        });
    } catch (error) {
        console.error('Error creando respaldo:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Obtener lista de respaldos
router.get('/backup/list', requireAdmin, async (req, res) => {
    try {
        const respaldos = await database.all(`
            SELECT * FROM respaldos 
            ORDER BY fecha_creacion DESC
        `);

        // Verificar que los archivos existen y obtener tamaño
        const respaldosConInfo = respaldos.map(respaldo => {
            try {
                const stats = fs.statSync(respaldo.ruta);
                return {
                    ...respaldo,
                    size: stats.size,
                    exists: true
                };
            } catch (error) {
                return {
                    ...respaldo,
                    size: 0,
                    exists: false
                };
            }
        });

        res.json({ success: true, data: respaldosConInfo });
    } catch (error) {
        console.error('Error obteniendo lista de respaldos:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Eliminar respaldo
router.delete('/backup/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        const respaldo = await database.get('SELECT * FROM respaldos WHERE id = ?', [id]);
        if (!respaldo) {
            return res.status(404).json({ error: 'Respaldo no encontrado' });
        }

        // Eliminar archivo físico
        try {
            fs.unlinkSync(respaldo.ruta);
        } catch (error) {
            console.warn('No se pudo eliminar el archivo físico:', error.message);
        }

        // Eliminar registro de la base de datos
        await database.run('DELETE FROM respaldos WHERE id = ?', [id]);

        // Registrar en historial
        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            ['eliminar_respaldo', req.session.userId, `Respaldo eliminado: ${respaldo.nombre_archivo}`, new Date().toISOString()]
        );

        res.json({ success: true, message: 'Respaldo eliminado exitosamente' });
    } catch (error) {
        console.error('Error eliminando respaldo:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Obtener reportes de ventas
router.get('/reports/sales', requireAdmin, async (req, res) => {
    try {
        const { start_date, end_date, group_by = 'day' } = req.query;

        const conditions = ["estado = 'pagado'"];
        const params = [];

        if (start_date && end_date) {
            conditions.push('DATE(fecha) BETWEEN ? AND ?');
            params.push(start_date, end_date);
        } else if (start_date) {
            conditions.push('DATE(fecha) >= ?');
            params.push(start_date);
        } else if (end_date) {
            conditions.push('DATE(fecha) <= ?');
            params.push(end_date);
        }

        const whereClause = `WHERE ${conditions.join(' AND ')}`;

        let groupByClause = '';
        switch (group_by) {
            case 'hour':
                groupByClause = "strftime('%Y-%m-%d %H:00', fecha)";
                break;
            case 'day':
                groupByClause = "DATE(fecha)";
                break;
            case 'week':
                groupByClause = "strftime('%Y-W%W', fecha)";
                break;
            case 'month':
                groupByClause = "strftime('%Y-%m', fecha)";
                break;
            default:
                groupByClause = "DATE(fecha)";
        }

        const ventas = await database.all(`
            SELECT ${groupByClause} as periodo,
                   COUNT(*) as num_pedidos,
                   SUM(total) as total_ventas,
                   AVG(total) as promedio_pedido
            FROM pedidos
            ${whereClause}
            GROUP BY ${groupByClause}
            ORDER BY periodo
        `, params);

        res.json({ success: true, data: ventas });
    } catch (error) {
        console.error('Error obteniendo reporte de ventas:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Obtener productos más vendidos
router.get('/reports/top-products', requireAdmin, async (req, res) => {
    try {
        const { limit = 10, start_date, end_date } = req.query;

        let dateFilter = '';
        let params = [];

        if (start_date && end_date) {
            dateFilter = 'AND DATE(p.fecha) BETWEEN ? AND ?';
            params = [start_date, end_date];
        }

        const productos = await database.all(`
            SELECT pr.nombre,
                   pr.precio,
                   SUM(pp.cantidad) as total_vendido,
                   SUM(pp.precio_unitario * pp.cantidad) as ingresos_totales,
                   COUNT(DISTINCT pp.pedido_id) as num_pedidos
            FROM pedido_productos pp
            JOIN productos pr ON pp.producto_id = pr.id
            JOIN pedidos p ON pp.pedido_id = p.id
            WHERE p.estado = 'pagado' ${dateFilter}
            GROUP BY pr.id, pr.nombre, pr.precio
            ORDER BY total_vendido DESC
            LIMIT ?
        `, [...params, parseInt(limit)]);

        res.json({ success: true, data: productos });
    } catch (error) {
        console.error('Error obteniendo productos más vendidos:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Restablecer base de datos (solo datos de usuario)
router.post('/reset-database', requireAdmin, async (req, res) => {
    try {
        // Crear respaldo automático antes del restablecimiento
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupName = `backup-before-reset-${timestamp}.db`;
        const backupPath = path.join(__dirname, '../../data/backups');

        // Crear directorio de respaldos si no existe
        if (!fs.existsSync(backupPath)) {
            fs.mkdirSync(backupPath, { recursive: true });
        }

        const fullBackupPath = path.join(backupPath, backupName);
        const sourcePath = path.join(__dirname, '../../data/restaurant.db');

        // Copiar archivo de base de datos como respaldo
        fs.copyFileSync(sourcePath, fullBackupPath);

        // Registrar respaldo en la base de datos
        await database.run(
            'INSERT INTO respaldos (nombre_archivo, ruta, fecha_creacion) VALUES (?, ?, ?)',
            [backupName, fullBackupPath, new Date().toISOString()]
        );

        // Contar registros antes del restablecimiento
        const pedidosCount = await database.get('SELECT COUNT(*) as count FROM pedidos');
        const pagosCount = await database.get('SELECT COUNT(*) as count FROM pagos');
        const creditosCount = await database.get('SELECT COUNT(*) as count FROM cuentas_credito');
        const historialCount = await database.get('SELECT COUNT(*) as count FROM historial_transacciones');
        const comandasCount = await database.get('SELECT COUNT(*) as count FROM comandas');
        const pagosCreditosCount = await database.get('SELECT COUNT(*) as count FROM pagos_creditos');

        // Eliminar datos del sistema (en orden para respetar claves foráneas)
        await database.run('DELETE FROM pedido_productos');
        await database.run('DELETE FROM pagos');
        await database.run('DELETE FROM comandas');
        await database.run('DELETE FROM pagos_creditos');
        await database.run('DELETE FROM pedidos');
        await database.run('DELETE FROM cuentas_credito');
        await database.run('DELETE FROM historial_transacciones');

        // 🔧 Reiniciar contadores de ID (AUTOINCREMENT)
        await database.run(`
            DELETE FROM sqlite_sequence 
            WHERE name IN (
                'pedidos',
                'pagos',
                'cuentas_credito',
                'pagos_creditos',
                'pedido_productos',
                'comandas',
                'historial_transacciones'
            )
        `);

        // Restablecer el estado de las mesas a 'libre'
        await database.run('UPDATE mesas SET estado = ?, cliente_nombre = NULL, fecha_apertura = NULL, cantidad_personas = NULL, hora_estimada = NULL', ['libre']);

        // Registrar la acción de restablecimiento en el historial
        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            [
                'restablecer_base_datos',
                req.session.userId,
                `Base de datos restablecida. Eliminados: ${pedidosCount.count} pedidos, ${pagosCount.count} pagos, ${creditosCount.count} créditos, ${historialCount.count} registros de historial, ${comandasCount.count} comandas, ${pagosCreditosCount.count} pagos de créditos. Respaldo creado: ${backupName}`,
                new Date().toISOString()
            ]
        );

        const totalEliminados = pedidosCount.count + pagosCount.count + creditosCount.count +
                               historialCount.count + comandasCount.count + pagosCreditosCount.count;

        res.json({
            success: true,
            data: {
                message: `${totalEliminados} registros eliminados exitosamente`,
                backup_created: backupName,
                details: {
                    pedidos_eliminados: pedidosCount.count,
                    pagos_eliminados: pagosCount.count,
                    creditos_eliminados: creditosCount.count,
                    historial_eliminado: historialCount.count,
                    comandas_eliminadas: comandasCount.count,
                    pagos_creditos_eliminados: pagosCreditosCount.count,
                    mesas_restablecidas: true
                }
            }
        });
    } catch (error) {
        console.error('Error restableciendo base de datos:', error);
        res.status(500).json({ error: 'Error interno del servidor al restablecer la base de datos' });
    }
});


module.exports = router;

