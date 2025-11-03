const express = require('express');
const database = require('../db/database');
const fs = require('fs');
const router = express.Router();
const multer = require('multer');
const path = require('path');

// Configuración de almacenamiento para imágenes de productos
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, path.join(__dirname, '../public/uploads/productos'));
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const extension = path.extname(file.originalname);
        cb(null, 'prod-' + uniqueSuffix + extension);
    }
});

const upload = multer({
    storage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB máx
    },
    fileFilter: function (req, file, cb) {
        const ext = path.extname(file.originalname).toLowerCase();
        if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
            return cb(new Error('Solo se permiten imágenes JPG, PNG o WEBP'));
        }
        cb(null, true);
    }
});

// Middleware para manejar errores de multer
function subirImagen(req, res, next) {
    console.log('📥 Middleware subirImagen ejecutado');

    upload.single('imagen')(req, res, function (err) {
        if (err instanceof multer.MulterError) {
            console.error('❌ Error de Multer:', err);
            return res.status(400).json({ error: 'Error al subir la imagen: ' + err.message });
        } else if (err) {
            console.error('❌ Error desconocido al procesar imagen:', err);
            return res.status(500).json({ error: 'Error interno al procesar la imagen' });
        }

        console.log('✅ Imagen procesada (si existe)');
        next();
    });
};

// Obtener todas las categorías
router.get('/categories', async (req, res) => {
    try {
        const categories = await database.all(`
            SELECT c.*, 
                   CASE WHEN c.parent_id IS NULL THEN 'principal' ELSE 'subcategoria' END as tipo,
                   p.nombre as categoria_padre
            FROM categorias c
            LEFT JOIN categorias p ON c.parent_id = p.id
            ORDER BY c.parent_id, c.nombre
        `);
        
        res.json({ success: true, data: categories });
    } catch (error) {
        console.error('Error obteniendo categorías:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Crear nueva categoría
router.post('/categories', async (req, res) => {
    try {
        const { nombre, parent_id, permite_cocina } = req.body;

        if (!nombre) {
            return res.status(400).json({ error: 'Nombre de categoría es requerido' });
        }

        // Verificar que no exista una categoría con el mismo nombre
        const existingCategory = await database.get('SELECT id FROM categorias WHERE nombre = ?', [nombre]);
        if (existingCategory) {
            return res.status(400).json({ error: 'Ya existe una categoría con ese nombre' });
        }

        // Si es subcategoría, verificar que la categoría padre existe
        if (parent_id) {
            const parentCategory = await database.get('SELECT id FROM categorias WHERE id = ?', [parent_id]);
            if (!parentCategory) {
                return res.status(400).json({ error: 'Categoría padre no encontrada' });
            }
        }

        const result = await database.run(
            'INSERT INTO categorias (nombre, parent_id, permite_cocina) VALUES (?, ?, ?)',
            [nombre, parent_id || null, permite_cocina ? 1 : 0]
        );

        // Registrar en historial
        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            ['crear_categoria', req.session.userId, `Categoría ${nombre} creada`, new Date().toISOString()]
        );

        res.json({ success: true, data: { id: result.id, nombre, parent_id, permite_cocina } });
    } catch (error) {
        console.error('Error creando categoría:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Obtener todos los productos
router.get('/products', async (req, res) => {
    try {
        const products = await database.all(`
            SELECT 
                p.*, 
                c.nombre as categoria_nombre,
                s.nombre as subcategoria_nombre,
                EXISTS (
                    SELECT 1 
                    FROM presentaciones_producto pp 
                    WHERE pp.producto_id = p.id 
                      AND pp.activo = 1
                ) AS tiene_presentaciones
            FROM productos p
            JOIN categorias c ON p.categoria_id = c.id
            LEFT JOIN categorias s ON p.subcategoria_id = s.id
            ORDER BY c.nombre, s.nombre, p.nombre
        `);
        
        res.json({ success: true, data: products });
    } catch (error) {
        console.error('Error obteniendo productos:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

//Mostrar todos los productos
router.get('/products/:id/presentaciones', async (req, res) => {
    const { id } = req.params;

    try {
        const producto = await database.get('SELECT * FROM productos WHERE id = ?', [id]);
        if (!producto) {
            return res.status(404).json({ error: 'Producto no encontrado' });
        }

        // Obtener todas las presentaciones globales activas
        const presentacionesGlobales = await database.all(`
            SELECT id, nombre, cantidad
            FROM presentaciones
            WHERE activo = 1
            ORDER BY nombre
        `);

        // Obtener las presentaciones asignadas al producto (si tiene)
        const presentacionesAsignadas = await database.all(`
            SELECT presentacion_id, precio
            FROM presentaciones_producto
            WHERE producto_id = ?
        `, [id]);

        // Mapear para facilitar la identificación
        const asignadasMap = {};
        presentacionesAsignadas.forEach(p => {
            asignadasMap[p.presentacion_id] = p.precio;
        });

        // Combinar datos: globales + si están asignadas y su precio
        const resultado = presentacionesGlobales.map(p => ({
            id: p.id,
            nombre: p.nombre,
            cantidad: p.cantidad,
            asignada: asignadasMap[p.id] !== undefined,
            precio: asignadasMap[p.id] ?? null
        }));

        res.json({
            success: true,
            data: {
                producto_nombre: producto.nombre,
                presentaciones: resultado
            }
        });

    } catch (error) {
        console.error('Error obteniendo presentaciones del producto:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Crear nuevo producto (ahora soporta presentaciones asociadas)
router.post('/products', async (req, res) => {
    try {
        console.log('📥 Datos recibidos en /products:', req.body);
        const {
            nombre,
            descripcion,
            precio,
            categoria_id,
            subcategoria_id,
            es_cocina,
            tiene_presentaciones,
            presentaciones_seleccionadas // array opcional [{nombre, precio}]
        } = req.body;

        if (!nombre || (!precio && !tiene_presentaciones) || !categoria_id) {
            return res.status(400).json({ error: 'Nombre, precio (o presentaciones) y categoría son requeridos' });
        }

        // Verificar categoría
        const categoria = await database.get('SELECT * FROM categorias WHERE id = ?', [categoria_id]);
        if (!categoria) {
            return res.status(400).json({ error: 'Categoría no encontrada' });
        }

        // Validar subcategoría y lógica de cocina
        if (subcategoria_id) {
            const subcategoria = await database.get(
                'SELECT * FROM categorias WHERE id = ? AND parent_id = ?',
                [subcategoria_id, categoria_id]
            );
            if (!subcategoria) {
                return res.status(400).json({ error: 'Subcategoría no válida para esta categoría' });
            }

            if (es_cocina) {
                if (categoria.nombre !== 'Alimentos' || subcategoria.nombre !== 'Preparados') {
                    return res.status(400).json({ 
                        error: 'Este producto no pertenece a la categoría de alimentos preparados y no puede marcarse como cocina' 
                    });
                }
            }
        } else if (es_cocina && !categoria.permite_cocina) {
            return res.status(400).json({ 
                error: 'Este producto no puede marcarse como cocina. Solo productos de alimentos preparados requieren comanda.' 
            });
        }

        // Insertar producto
        const result = await database.run(
            'INSERT INTO productos (nombre, descripcion, precio, categoria_id, subcategoria_id, es_cocina) VALUES (?, ?, ?, ?, ?, ?)',
            [nombre, descripcion, precio || 0, categoria_id, subcategoria_id || null, es_cocina ? 1 : 0]
        );

        const productoId = result.id;

        // Si tiene presentaciones, insertarlas
        if (tiene_presentaciones && Array.isArray(presentaciones_seleccionadas)) {
            for (const pres of presentaciones_seleccionadas) {
                if (!pres.id || isNaN(pres.id)) continue; // seguridad
                await database.run(
                    `INSERT INTO presentaciones_producto (producto_id, presentacion_id, precio) VALUES (?, ?, ?)`,
                    [productoId, pres.id, pres.precio || 0]
                );
            }
        }



        // Historial
        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            ['crear_producto', req.session.userId, `Producto ${nombre} creado`, new Date().toISOString()]
        );

        res.json({
            success: true,
            data: {
                id: productoId,
                nombre,
                descripcion,
                precio,
                categoria_id,
                subcategoria_id,
                es_cocina,
                tiene_presentaciones: !!(tiene_presentaciones && presentaciones_seleccionadas?.length)
            }
        });
    } catch (error) {
        console.error('Error creando producto:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Actualizar producto
router.put('/products/:id', async (req, res) => {
    const { id } = req.params;
    const {
        nombre,
        descripcion,
        precio,
        categoria_id,
        subcategoria_id,
        es_cocina,
        presentaciones
    } = req.body;

    const db = await database;

    try {
        await db.run('BEGIN');

        // Actualizar producto base
        await db.run(`
            UPDATE productos
            SET nombre = ?, descripcion = ?, precio = ?, categoria_id = ?, subcategoria_id = ?, es_cocina = ?
            WHERE id = ?
        `, [
            nombre,
            descripcion,
            precio || 0,
            categoria_id,
            subcategoria_id,
            es_cocina ? 1 : 0,
            id
        ]);

        // Si se incluyen presentaciones, actualizarlas
        if (Array.isArray(presentaciones)) {
            const presentacionesAsignadasIds = [];

            for (const p of presentaciones) {
                const { presentacion_id, precio } = p;

                // Verificar si ya existe la asignación
                const existente = await db.get(`
                    SELECT id FROM presentaciones_producto
                    WHERE producto_id = ? AND presentacion_id = ?
                `, [id, presentacion_id]);

                if (existente) {
                    // Actualizar precio y marcar como activo
                    await db.run(`
                        UPDATE presentaciones_producto
                        SET precio = ?, activo = 1, actualizado_en = CURRENT_TIMESTAMP
                        WHERE id = ?
                    `, [precio, existente.id]);
                } else {
                    // Crear nueva asignación
                    await db.run(`
                        INSERT INTO presentaciones_producto (producto_id, presentacion_id, precio, activo, creado_en, actualizado_en)
                        VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    `, [id, presentacion_id, precio]);
                }

                presentacionesAsignadasIds.push(presentacion_id);
            }

            // Desactivar otras presentaciones que ya no están seleccionadas
            if (presentacionesAsignadasIds.length > 0) {
                const placeholders = presentacionesAsignadasIds.map(() => '?').join(',');
                await db.run(`
                    UPDATE presentaciones_producto
                    SET activo = 0, actualizado_en = CURRENT_TIMESTAMP
                    WHERE producto_id = ? AND presentacion_id NOT IN (${placeholders})
                `, [id, ...presentacionesAsignadasIds]);
            }
        }

        await db.run('COMMIT');

        res.json({ success: true, message: 'Producto actualizado con éxito' });
    } catch (error) {
        await db.run('ROLLBACK');
        console.error('Error actualizando producto:', error);
        res.status(500).json({ error: 'Error al actualizar el producto' });
    }
});


// Eliminar producto
router.delete('/products/:id', async (req, res) => {
    const { id } = req.params;
    const db = await database;

    try {
        // Verificar que el producto existe
        const producto = await db.get('SELECT * FROM productos WHERE id = ?', [id]);
        if (!producto) {
            return res.status(404).json({ error: 'Producto no encontrado' });
        }

        // Verificar que no esté en pedidos pendientes
        const pedidosPendientes = await db.get(`
            SELECT COUNT(*) as count
            FROM pedido_productos pp
            JOIN pedidos p ON pp.pedido_id = p.id
            WHERE pp.producto_id = ? AND p.estado = ?
        `, [id, 'pendiente']);

        if (pedidosPendientes.count > 0) {
            return res.status(400).json({ error: 'No se puede eliminar un producto que está en pedidos pendientes' });
        }

        await db.run('BEGIN');

        // 🔥 Eliminar presentaciones asociadas
        await db.run('DELETE FROM presentaciones_producto WHERE producto_id = ?', [id]);

        // 🔥 (Opcional) Eliminar de favoritos, si tuvieras esa tabla
        // await db.run('DELETE FROM favoritos WHERE producto_id = ?', [id]);

        // 🔥 (Opcional) Eliminar de otros módulos (créditos, stock, etc.)

        // 🗑️ Eliminar el producto
        await db.run('DELETE FROM productos WHERE id = ?', [id]);

        // 📝 Registrar en historial
        await db.run(`
            INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha)
            VALUES (?, ?, ?, ?)
        `, [
            'eliminar_producto',
            req.session.userId,
            `Producto ${producto.nombre} eliminado`,
            new Date().toISOString()
        ]);

        await db.run('COMMIT');

        res.json({ success: true, message: 'Producto eliminado exitosamente' });
    } catch (error) {
        await db.run('ROLLBACK');
        console.error('Error eliminando producto:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});


// Buscar productos
router.get('/products/search', async (req, res) => {
    try {
        const { q } = req.query;
        
        if (!q) {
            return res.status(400).json({ error: 'Término de búsqueda requerido' });
        }

        const products = await database.all(`
            SELECT p.*, 
                   c.nombre as categoria_nombre,
                   s.nombre as subcategoria_nombre
            FROM productos p
            JOIN categorias c ON p.categoria_id = c.id
            LEFT JOIN categorias s ON p.subcategoria_id = s.id
            WHERE p.nombre LIKE ? OR p.descripcion LIKE ?
            ORDER BY p.nombre
        `, [`%${q}%`, `%${q}%`]);
        
        res.json({ success: true, data: products });
    } catch (error) {
        console.error('Error buscando productos:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Obtener presentaciones de un producto
router.get('/products/:id/presentaciones', async (req, res) => {
    const { id } = req.params;
    const db = await database;

    try {
        // Obtener nombre del producto
        const producto = await db.get(`SELECT nombre FROM productos WHERE id = ?`, [id]);
        if (!producto) return res.status(404).json({ error: 'Producto no encontrado' });

        // Consultar todas las presentaciones globales activas
        const presentaciones = await db.all(`
            SELECT 
                p.id AS presentacion_id,
                p.nombre,
                p.cantidad,
                IFNULL(pp.precio, 0) AS precio,
                CASE WHEN pp.id IS NOT NULL AND pp.activo = 1 THEN 1 ELSE 0 END AS asignada
            FROM presentaciones p
            LEFT JOIN presentaciones_producto pp 
                ON pp.presentacion_id = p.id AND pp.producto_id = ?
            WHERE p.activo = 1
            ORDER BY p.nombre
        `, [id]);

        res.json({
            producto_nombre: producto.nombre,
            presentaciones
        });

    } catch (error) {
        console.error("Error obteniendo presentaciones del producto:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

// Obtener menú completo organizado por categoría > subcategoría > productos > presentaciones
router.get('/completo', async (req, res) => {
    try {
        // Obtener todas las categorías principales (sin parent_id)
        const categorias = await database.all(`
            SELECT * FROM categorias WHERE parent_id IS NULL ORDER BY nombre
        `);

        const menu = [];

        for (const categoria of categorias) {
            // Subcategorías de esta categoría
            const subcategorias = await database.all(
                'SELECT * FROM categorias WHERE parent_id = ? ORDER BY nombre',
                [categoria.id]
            );

            const subcategoriasEstructuradas = [];

            for (const sub of subcategorias) {
                // Productos dentro de esta subcategoría
                const productos = await database.all(
                    `SELECT * FROM productos WHERE categoria_id = ? AND subcategoria_id = ? ORDER BY nombre`,
                    [categoria.id, sub.id]
                );

                const productosConPresentaciones = [];

                for (const prod of productos) {
                    // Buscar presentaciones asociadas
                    const presentaciones = await database.all(
                        `SELECT id, nombre, precio FROM presentaciones_producto WHERE producto_id = ? AND activo = 1 ORDER BY nombre`,
                        [prod.id]
                    );

                    productosConPresentaciones.push({
                        id: prod.id,
                        nombre: prod.nombre,
                        descripcion: prod.descripcion,
                        precio: prod.precio,
                        tiene_presentaciones: presentaciones.length > 0,
                        presentaciones
                    });
                }

                subcategoriasEstructuradas.push({
                    id: sub.id,
                    nombre: sub.nombre,
                    productos: productosConPresentaciones
                });
            }

            menu.push({
                id: categoria.id,
                nombre: categoria.nombre,
                subcategorias: subcategoriasEstructuradas
            });
        }

        res.json({ success: true, data: menu });
    } catch (error) {
        console.error('Error generando menú completo:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

router.get('/presentaciones-globales', async (req, res) => {
    try {
        const presentaciones = await database.all(`
            SELECT id, nombre, tipo, cantidad, activo
            FROM presentaciones
            WHERE activo = 1
            ORDER BY nombre ASC
        `);

        res.json({ success: true, data: presentaciones });
    } catch (error) {
        console.error('Error al obtener presentaciones globales:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

router.post('/presentaciones-globales', async (req, res) => {
    try {
        const { nombre, tipo, cantidad } = req.body;

        if (!nombre || nombre.trim() === '') {
            return res.status(400).json({ error: 'El nombre es requerido' });
        }

        const now = new Date().toISOString();

        const result = await database.run(`
            INSERT INTO presentaciones (nombre, tipo, cantidad, activo, creado_en, actualizado_en)
            VALUES (?, ?, ?, 1, ?, ?)
        `, [nombre.trim(), tipo || 'tamaño', cantidad || null, now, now]);

        res.json({
            success: true,
            data: {
                id: result.lastID,
                nombre,
                tipo: tipo || 'tamaño',
                cantidad
            }
        });
    } catch (error) {
        if (error.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ error: 'Ya existe una presentación con ese nombre' });
        }
        console.error('Error al crear presentación global:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

router.delete('/presentaciones-globales/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const result = await database.run(`
            DELETE FROM presentaciones
            WHERE id = ?
        `, [id]);

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Presentación no encontrada' });
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Error al eliminar presentación:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});
// Eliminar categoría o subcategoría
router.delete('/categories/:id', async (req, res) => {
    const { id } = req.params;
    const db = await database;

    try {
        // Verificar si existe
        const categoria = await db.get('SELECT * FROM categorias WHERE id = ?', [id]);
        if (!categoria) {
            return res.status(404).json({ error: 'Categoría no encontrada' });
        }

        // Validar si tiene subcategorías (si es principal)
        if (!categoria.parent_id) {
            const subcategorias = await db.get('SELECT COUNT(*) as count FROM categorias WHERE parent_id = ?', [id]);
            if (subcategorias.count > 0) {
                return res.status(400).json({ error: 'No se puede eliminar una categoría con subcategorías asociadas' });
            }
        }

        // Validar si está usada por algún producto
        const productosAsociados = await db.get(`
            SELECT COUNT(*) as count FROM productos 
            WHERE categoria_id = ? OR subcategoria_id = ?
        `, [id, id]);

        if (productosAsociados.count > 0) {
            return res.status(400).json({ error: 'No se puede eliminar una categoría en uso por productos' });
        }

        await db.run('BEGIN');

        await db.run('DELETE FROM categorias WHERE id = ?', [id]);

        await db.run(`
            INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha)
            VALUES (?, ?, ?, ?)
        `, [
            'eliminar_categoria',
            req.session.userId,
            `Categoría "${categoria.nombre}" eliminada`,
            new Date().toISOString()
        ]);

        await db.run('COMMIT');

        res.json({ success: true, message: 'Categoría eliminada correctamente' });
    } catch (error) {
        await db.run('ROLLBACK');
        console.error('Error eliminando categoría:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});


module.exports = router;