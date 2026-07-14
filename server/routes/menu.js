const express = require('express');
const database = require('../db/database');
const fs = require('fs');
const multer = require('multer');
const path = require('path');

const router = express.Router();
const PRODUCT_UPLOAD_DIR = path.join(__dirname, '../../public/uploads/productos');

if (!fs.existsSync(PRODUCT_UPLOAD_DIR)) {
    fs.mkdirSync(PRODUCT_UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, PRODUCT_UPLOAD_DIR),
    filename: (req, file, cb) => {
        const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
        cb(null, `prod-${uniqueSuffix}${path.extname(file.originalname).toLowerCase()}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter(req, file, cb) {
        const ext = path.extname(file.originalname).toLowerCase();
        if (!['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext)) {
            return cb(new Error('Solo se permiten imágenes JPG, PNG, WEBP o GIF'));
        }
        cb(null, true);
    }
});

function subirImagen(req, res, next) {
    upload.single('imagen')(req, res, (err) => {
        if (err instanceof multer.MulterError) {
            return res.status(400).json({ error: `Error al subir la imagen: ${err.message}` });
        }
        if (err) {
            return res.status(400).json({ error: err.message || 'Error al procesar la imagen' });
        }
        next();
    });
}

function parseBoolean(value) {
    return value === true || value === 1 || value === '1' || value === 'true' || value === 'on';
}

function parseNumber(value, fallback = null) {
    if (value === undefined || value === null || value === '') return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function parseArray(value) {
    if (Array.isArray(value)) return value;
    if (!value) return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        return [];
    }
}

function uploadedImagePath(req) {
    return req.file ? `/uploads/productos/${req.file.filename}` : null;
}

async function validarCategoria(categoriaId, subcategoriaId, esCocina) {
    const categoria = await database.get('SELECT * FROM categorias WHERE id = ?', [categoriaId]);
    if (!categoria) {
        return 'Categoría no encontrada';
    }

    if (subcategoriaId) {
        const subcategoria = await database.get(
            'SELECT * FROM categorias WHERE id = ? AND parent_id = ?',
            [subcategoriaId, categoriaId]
        );
        if (!subcategoria) {
            return 'Subcategoría no válida para esta categoría';
        }

        if (esCocina && !subcategoria.permite_cocina && !categoria.permite_cocina) {
            return 'Esta combinación de categoría/subcategoría no permite productos de cocina';
        }
    } else if (esCocina && !categoria.permite_cocina) {
        return 'Esta categoría no permite productos de cocina';
    }

    return null;
}


function moneyNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeProductImage(product) {
    return product?.imagen || product?.imagen_url || null;
}

function normalizePresentationForOperation(row) {
    const precio = moneyNumber(row.precio, 0);
    return {
        id: Number(row.presentacion_id || row.id),
        presentacion_id: Number(row.presentacion_id || row.id),
        producto_presentacion_id: row.producto_presentacion_id ? Number(row.producto_presentacion_id) : null,
        nombre: row.nombre,
        tipo: row.tipo || 'tamaño',
        cantidad: row.cantidad || null,
        precio,
        precio_operativo: precio,
        activo: Number(row.activo) === 1 ? 1 : 0,
        imagen: row.imagen || null,
        disponible_operacion: precio > 0 ? 1 : 0
    };
}

function buildOperationalCategoryList(categories, products, includeEmpty = false) {
    const counters = new Map();

    products.forEach(product => {
        const categoriaId = Number(product.categoria_id);
        const subcategoriaId = product.subcategoria_id ? Number(product.subcategoria_id) : null;
        counters.set(categoriaId, (counters.get(categoriaId) || 0) + 1);
        if (subcategoriaId) {
            counters.set(subcategoriaId, (counters.get(subcategoriaId) || 0) + 1);
        }
    });

    return categories
        .map(category => ({
            id: Number(category.id),
            nombre: category.nombre,
            parent_id: category.parent_id ? Number(category.parent_id) : null,
            tipo: category.parent_id ? 'subcategoria' : 'principal',
            categoria_padre: category.categoria_padre || null,
            permite_cocina: Number(category.permite_cocina) === 1 ? 1 : 0,
            total_productos_operativos: counters.get(Number(category.id)) || 0
        }))
        .filter(category => includeEmpty || category.total_productos_operativos > 0 || category.tipo === 'principal');
}

async function buildOperationalMenuPayload(options = {}) {
    const includeInvalid = options.includeInvalid === true;
    const includeEmptyCategories = options.includeEmptyCategories === true;

    const categories = await database.all(`
        SELECT c.id, c.nombre, c.parent_id, c.permite_cocina, p.nombre AS categoria_padre
        FROM categorias c
        LEFT JOIN categorias p ON c.parent_id = p.id
        ORDER BY c.parent_id IS NOT NULL, c.parent_id, c.nombre
    `);

    const products = await database.all(`
        SELECT
            p.id,
            p.nombre,
            p.descripcion,
            COALESCE(p.precio, 0) AS precio,
            p.categoria_id,
            p.subcategoria_id,
            p.es_cocina,
            p.imagen,
            c.nombre AS categoria_nombre,
            c.permite_cocina AS categoria_permite_cocina,
            s.nombre AS subcategoria_nombre,
            s.permite_cocina AS subcategoria_permite_cocina
        FROM productos p
        JOIN categorias c ON p.categoria_id = c.id
        LEFT JOIN categorias s ON p.subcategoria_id = s.id
        ORDER BY c.nombre, COALESCE(s.nombre, ''), p.nombre
    `);

    const presentationRows = await database.all(`
        SELECT
            pp.producto_id,
            pp.id AS producto_presentacion_id,
            pp.presentacion_id,
            pr.nombre,
            pr.tipo,
            pr.cantidad,
            COALESCE(pp.precio, 0) AS precio,
            pp.activo,
            pp.imagen
        FROM presentaciones_producto pp
        JOIN presentaciones pr ON pp.presentacion_id = pr.id
        WHERE pp.activo = 1 AND pr.activo = 1
        ORDER BY pr.nombre
    `);

    const presentationsByProduct = new Map();
    presentationRows.forEach(row => {
        const productId = Number(row.producto_id);
        if (!presentationsByProduct.has(productId)) {
            presentationsByProduct.set(productId, []);
        }
        presentationsByProduct.get(productId).push(normalizePresentationForOperation(row));
    });

    const normalizedProducts = products.map(product => {
        const productId = Number(product.id);
        const precioBase = moneyNumber(product.precio, 0);
        const presentaciones = presentationsByProduct.get(productId) || [];
        const presentacionesValidas = presentaciones.filter(presentation => presentation.disponible_operacion === 1);
        const tienePresentaciones = presentacionesValidas.length > 0;
        const bloqueos = [];
        let precioOperativo = null;
        let origenPrecio = 'presentacion';
        let precioMinimo = null;
        let precioMaximo = null;

        if (tienePresentaciones) {
            const precios = presentacionesValidas.map(presentation => presentation.precio_operativo);
            precioMinimo = Math.min(...precios);
            precioMaximo = Math.max(...precios);
        } else if (precioBase > 0) {
            precioOperativo = precioBase;
            precioMinimo = precioBase;
            precioMaximo = precioBase;
            origenPrecio = 'producto';
        } else {
            origenPrecio = 'sin_precio_valido';
            bloqueos.push('Producto sin precio operativo válido');
        }

        if (presentaciones.length > 0 && presentacionesValidas.length === 0) {
            bloqueos.push('Producto con presentaciones sin precio operativo válido');
        }

        const categoriaNombre = product.subcategoria_nombre || product.categoria_nombre;
        const operativo = bloqueos.length === 0 ? 1 : 0;

        return {
            id: productId,
            producto_id: productId,
            nombre: product.nombre,
            descripcion: product.descripcion || '',
            imagen: normalizeProductImage(product),
            imagen_url: normalizeProductImage(product),
            categoria_id: Number(product.categoria_id),
            categoria_nombre: product.categoria_nombre,
            subcategoria_id: product.subcategoria_id ? Number(product.subcategoria_id) : null,
            subcategoria_nombre: product.subcategoria_nombre || null,
            categoria_operativa: categoriaNombre,
            es_cocina: Number(product.es_cocina) === 1 ? 1 : 0,
            requiere_comanda: Number(product.es_cocina) === 1 ? 1 : 0,
            tiene_presentaciones: tienePresentaciones ? 1 : 0,
            precio_base: precioBase,
            precio: precioOperativo ?? precioBase,
            precio_operativo: precioOperativo,
            precio_minimo: precioMinimo,
            precio_maximo: precioMaximo,
            origen_precio: origenPrecio,
            presentaciones: presentacionesValidas,
            total_presentaciones: presentacionesValidas.length,
            disponible_operacion: operativo,
            bloqueos_operativos: bloqueos
        };
    });

    const operationalProducts = includeInvalid
        ? normalizedProducts
        : normalizedProducts.filter(product => product.disponible_operacion === 1);

    return {
        version_contrato: 'v2.2.5M.2',
        generado_en: new Date().toISOString(),
        categorias: buildOperationalCategoryList(categories, operationalProducts, includeEmptyCategories),
        productos: operationalProducts,
        resumen: {
            total_productos: products.length,
            total_productos_operativos: normalizedProducts.filter(product => product.disponible_operacion === 1).length,
            total_productos_invalidos: normalizedProducts.filter(product => product.disponible_operacion !== 1).length,
            total_categorias: categories.length
        }
    };
}

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
        const nombreLimpio = String(nombre || '').trim();

        if (!nombreLimpio) {
            return res.status(400).json({ error: 'Nombre de categoría es requerido' });
        }

        const existingCategory = await database.get('SELECT id FROM categorias WHERE nombre = ?', [nombreLimpio]);
        if (existingCategory) {
            return res.status(400).json({ error: 'Ya existe una categoría con ese nombre' });
        }

        const parentId = parseNumber(parent_id, null);
        if (parentId) {
            const parentCategory = await database.get('SELECT id FROM categorias WHERE id = ?', [parentId]);
            if (!parentCategory) {
                return res.status(400).json({ error: 'Categoría padre no encontrada' });
            }
        }

        const result = await database.run(
            'INSERT INTO categorias (nombre, parent_id, permite_cocina) VALUES (?, ?, ?)',
            [nombreLimpio, parentId, parseBoolean(permite_cocina) ? 1 : 0]
        );

        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            ['crear_categoria', req.session.userId, `Categoría ${nombreLimpio} creada`, new Date().toISOString()]
        );

        res.json({
            success: true,
            data: { id: result.id, nombre: nombreLimpio, parent_id: parentId, permite_cocina: parseBoolean(permite_cocina) ? 1 : 0 }
        });
    } catch (error) {
        console.error('Error creando categoría:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Eliminar categoría o subcategoría
router.delete('/categories/:id', async (req, res) => {
    const { id } = req.params;
    let transactionStarted = false;

    try {
        const categoria = await database.get('SELECT * FROM categorias WHERE id = ?', [id]);
        if (!categoria) {
            return res.status(404).json({ error: 'Categoría no encontrada' });
        }

        if (!categoria.parent_id) {
            const subcategorias = await database.get('SELECT COUNT(*) as count FROM categorias WHERE parent_id = ?', [id]);
            if (subcategorias.count > 0) {
                return res.status(400).json({ error: 'No se puede eliminar una categoría con subcategorías asociadas' });
            }
        }

        const productosAsociados = await database.get(`
            SELECT COUNT(*) as count FROM productos
            WHERE categoria_id = ? OR subcategoria_id = ?
        `, [id, id]);

        if (productosAsociados.count > 0) {
            return res.status(400).json({ error: 'No se puede eliminar una categoría en uso por productos' });
        }

        await database.run('BEGIN');
        transactionStarted = true;
        await database.run('DELETE FROM categorias WHERE id = ?', [id]);
        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            ['eliminar_categoria', req.session.userId, `Categoría "${categoria.nombre}" eliminada`, new Date().toISOString()]
        );
        await database.run('COMMIT');

        res.json({ success: true, message: 'Categoría eliminada correctamente' });
    } catch (error) {
        if (transactionStarted) await database.run('ROLLBACK').catch(() => {});
        console.error('Error eliminando categoría:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});



// Obtener productos normalizados para operación de Cuentas/Orders
router.get('/operational-products', async (req, res) => {
    try {
        const includeInvalid = parseBoolean(req.query.include_invalid);
        const includeEmptyCategories = parseBoolean(req.query.include_empty_categories);
        const payload = await buildOperationalMenuPayload({ includeInvalid, includeEmptyCategories });

        res.json({
            success: true,
            data: payload,
            categorias: payload.categorias,
            productos: payload.productos,
            resumen: payload.resumen,
            version_contrato: payload.version_contrato
        });
    } catch (error) {
        console.error('Error obteniendo productos operativos:', error);
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
                    WHERE pp.producto_id = p.id AND pp.activo = 1
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

// Buscar productos
router.get('/products/search', async (req, res) => {
    try {
        const { q } = req.query;
        if (!q) {
            return res.status(400).json({ error: 'Término de búsqueda requerido' });
        }

        const products = await database.all(`
            SELECT p.*, c.nombre as categoria_nombre, s.nombre as subcategoria_nombre,
                   EXISTS (
                       SELECT 1 FROM presentaciones_producto pp
                       WHERE pp.producto_id = p.id AND pp.activo = 1
                   ) AS tiene_presentaciones
            FROM productos p
            JOIN categorias c ON p.categoria_id = c.id
            LEFT JOIN categorias s ON p.subcategoria_id = s.id
            WHERE p.nombre LIKE ? OR COALESCE(p.descripcion, '') LIKE ?
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

    try {
        const producto = await database.get('SELECT nombre FROM productos WHERE id = ?', [id]);
        if (!producto) {
            return res.status(404).json({ error: 'Producto no encontrado' });
        }

        const presentaciones = await database.all(`
            SELECT 
                p.id,
                p.id AS presentacion_id,
                p.nombre,
                p.cantidad,
                COALESCE(pp.precio, 0) AS precio,
                CASE WHEN pp.id IS NOT NULL AND pp.activo = 1 THEN 1 ELSE 0 END AS asignada
            FROM presentaciones p
            LEFT JOIN presentaciones_producto pp
                ON pp.presentacion_id = p.id AND pp.producto_id = ?
            WHERE p.activo = 1
            ORDER BY p.nombre
        `, [id]);

        res.json({
            success: true,
            producto_nombre: producto.nombre,
            presentaciones,
            data: {
                producto_nombre: producto.nombre,
                presentaciones
            }
        });
    } catch (error) {
        console.error('Error obteniendo presentaciones del producto:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Crear nuevo producto
router.post('/products', subirImagen, async (req, res) => {
    let transactionStarted = false;

    try {
        const nombre = String(req.body.nombre || '').trim();
        const descripcion = req.body.descripcion || '';
        const categoriaId = parseNumber(req.body.categoria_id);
        const subcategoriaId = parseNumber(req.body.subcategoria_id, null);
        const esCocina = parseBoolean(req.body.es_cocina);
        const tienePresentaciones = parseBoolean(req.body.tiene_presentaciones);
        const presentacionesSeleccionadas = parseArray(req.body.presentaciones_seleccionadas);
        const precio = tienePresentaciones ? 0 : parseNumber(req.body.precio, NaN);
        const imagen = uploadedImagePath(req);

        if (!nombre || !categoriaId || (!tienePresentaciones && (!Number.isFinite(precio) || precio <= 0))) {
            return res.status(400).json({ error: 'Nombre, precio (o presentaciones) y categoría son requeridos' });
        }

        if (tienePresentaciones) {
            const validas = presentacionesSeleccionadas.filter(p => parseNumber(p.id) && parseNumber(p.precio, 0) > 0);
            if (validas.length === 0) {
                return res.status(400).json({ error: 'Debe seleccionar al menos una presentación con precio mayor a cero' });
            }
        }

        const categoriaError = await validarCategoria(categoriaId, subcategoriaId, esCocina);
        if (categoriaError) {
            return res.status(400).json({ error: categoriaError });
        }

        await database.run('BEGIN');
        transactionStarted = true;

        const result = await database.run(
            `INSERT INTO productos (nombre, descripcion, precio, categoria_id, subcategoria_id, es_cocina, imagen)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [nombre, descripcion, Number.isFinite(precio) ? precio : 0, categoriaId, subcategoriaId, esCocina ? 1 : 0, imagen]
        );

        const productoId = result.id;

        if (tienePresentaciones) {
            for (const pres of presentacionesSeleccionadas) {
                const presentacionId = parseNumber(pres.id);
                const precioPresentacion = parseNumber(pres.precio, 0);
                if (!presentacionId || precioPresentacion <= 0) continue;

                await database.run(
                    `INSERT INTO presentaciones_producto (producto_id, presentacion_id, precio, activo, creado_en, actualizado_en)
                     VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
                    [productoId, presentacionId, precioPresentacion]
                );
            }
        }

        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            ['crear_producto', req.session.userId, `Producto ${nombre} creado`, new Date().toISOString()]
        );

        await database.run('COMMIT');

        res.json({
            success: true,
            data: {
                id: productoId,
                nombre,
                descripcion,
                precio: Number.isFinite(precio) ? precio : 0,
                categoria_id: categoriaId,
                subcategoria_id: subcategoriaId,
                es_cocina: esCocina ? 1 : 0,
                imagen,
                tiene_presentaciones: tienePresentaciones ? 1 : 0
            }
        });
    } catch (error) {
        if (transactionStarted) await database.run('ROLLBACK').catch(() => {});
        console.error('Error creando producto:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Actualizar producto
router.put('/products/:id', subirImagen, async (req, res) => {
    const { id } = req.params;
    let transactionStarted = false;

    try {
        const producto = await database.get('SELECT * FROM productos WHERE id = ?', [id]);
        if (!producto) {
            return res.status(404).json({ error: 'Producto no encontrado' });
        }

        const nombre = String(req.body.nombre || producto.nombre || '').trim();
        const descripcion = req.body.descripcion ?? producto.descripcion ?? '';
        const categoriaId = parseNumber(req.body.categoria_id, producto.categoria_id);
        const subcategoriaId = parseNumber(req.body.subcategoria_id, null);
        const esCocina = parseBoolean(req.body.es_cocina);
        const precio = parseNumber(req.body.precio, producto.precio || 0);
        const presentaciones = req.body.presentaciones !== undefined ? parseArray(req.body.presentaciones) : null;
        const imagen = uploadedImagePath(req) || producto.imagen || null;

        if (!nombre || !categoriaId || precio < 0) {
            return res.status(400).json({ error: 'Nombre, categoría y precio válido son requeridos' });
        }

        const categoriaError = await validarCategoria(categoriaId, subcategoriaId, esCocina);
        if (categoriaError) {
            return res.status(400).json({ error: categoriaError });
        }

        await database.run('BEGIN');
        transactionStarted = true;

        await database.run(`
            UPDATE productos
            SET nombre = ?, descripcion = ?, precio = ?, categoria_id = ?, subcategoria_id = ?, es_cocina = ?, imagen = ?
            WHERE id = ?
        `, [nombre, descripcion, precio, categoriaId, subcategoriaId, esCocina ? 1 : 0, imagen, id]);

        if (Array.isArray(presentaciones)) {
            const presentacionesAsignadasIds = [];

            for (const p of presentaciones) {
                const presentacionId = parseNumber(p.presentacion_id || p.id);
                const precioPresentacion = parseNumber(p.precio, 0);
                if (!presentacionId || precioPresentacion <= 0) continue;

                const existente = await database.get(`
                    SELECT id FROM presentaciones_producto
                    WHERE producto_id = ? AND presentacion_id = ?
                `, [id, presentacionId]);

                if (existente) {
                    await database.run(`
                        UPDATE presentaciones_producto
                        SET precio = ?, activo = 1, actualizado_en = CURRENT_TIMESTAMP
                        WHERE id = ?
                    `, [precioPresentacion, existente.id]);
                } else {
                    await database.run(`
                        INSERT INTO presentaciones_producto (producto_id, presentacion_id, precio, activo, creado_en, actualizado_en)
                        VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    `, [id, presentacionId, precioPresentacion]);
                }

                presentacionesAsignadasIds.push(presentacionId);
            }

            if (presentacionesAsignadasIds.length > 0) {
                const placeholders = presentacionesAsignadasIds.map(() => '?').join(',');
                await database.run(`
                    UPDATE presentaciones_producto
                    SET activo = 0, actualizado_en = CURRENT_TIMESTAMP
                    WHERE producto_id = ? AND presentacion_id NOT IN (${placeholders})
                `, [id, ...presentacionesAsignadasIds]);
            } else {
                await database.run(`
                    UPDATE presentaciones_producto
                    SET activo = 0, actualizado_en = CURRENT_TIMESTAMP
                    WHERE producto_id = ?
                `, [id]);
            }
        }

        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            ['actualizar_producto', req.session.userId, `Producto ${nombre} actualizado`, new Date().toISOString()]
        );

        await database.run('COMMIT');

        res.json({ success: true, message: 'Producto actualizado con éxito' });
    } catch (error) {
        if (transactionStarted) await database.run('ROLLBACK').catch(() => {});
        console.error('Error actualizando producto:', error);
        res.status(500).json({ error: 'Error al actualizar el producto' });
    }
});

// Eliminar producto
router.delete('/products/:id', async (req, res) => {
    const { id } = req.params;
    let transactionStarted = false;

    try {
        const producto = await database.get('SELECT * FROM productos WHERE id = ?', [id]);
        if (!producto) {
            return res.status(404).json({ error: 'Producto no encontrado' });
        }

        const pedidosPendientes = await database.get(`
            SELECT COUNT(*) as count
            FROM pedido_productos pp
            JOIN pedidos p ON pp.pedido_id = p.id
            WHERE pp.producto_id = ? AND p.estado = ?
        `, [id, 'pendiente']);

        if (pedidosPendientes.count > 0) {
            return res.status(400).json({ error: 'No se puede eliminar un producto que está en pedidos pendientes' });
        }

        await database.run('BEGIN');
        transactionStarted = true;
        await database.run('DELETE FROM presentaciones_producto WHERE producto_id = ?', [id]);
        await database.run('DELETE FROM productos WHERE id = ?', [id]);
        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            ['eliminar_producto', req.session.userId, `Producto ${producto.nombre} eliminado`, new Date().toISOString()]
        );
        await database.run('COMMIT');

        res.json({ success: true, message: 'Producto eliminado exitosamente' });
    } catch (error) {
        if (transactionStarted) await database.run('ROLLBACK').catch(() => {});
        console.error('Error eliminando producto:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Obtener menú completo organizado por categoría > subcategoría > productos > presentaciones
router.get('/completo', async (req, res) => {
    try {
        const categorias = await database.all('SELECT * FROM categorias WHERE parent_id IS NULL ORDER BY nombre');
        const menu = [];

        for (const categoria of categorias) {
            const subcategorias = await database.all(
                'SELECT * FROM categorias WHERE parent_id = ? ORDER BY nombre',
                [categoria.id]
            );

            const subcategoriasEstructuradas = [];
            for (const sub of subcategorias) {
                const productos = await database.all(
                    'SELECT * FROM productos WHERE categoria_id = ? AND subcategoria_id = ? ORDER BY nombre',
                    [categoria.id, sub.id]
                );

                const productosConPresentaciones = [];
                for (const prod of productos) {
                    const presentaciones = await database.all(`
                        SELECT pp.id, pp.presentacion_id, p.nombre, p.cantidad, pp.precio
                        FROM presentaciones_producto pp
                        JOIN presentaciones p ON pp.presentacion_id = p.id
                        WHERE pp.producto_id = ? AND pp.activo = 1
                        ORDER BY p.nombre
                    `, [prod.id]);

                    productosConPresentaciones.push({
                        ...prod,
                        tiene_presentaciones: presentaciones.length > 0,
                        presentaciones
                    });
                }

                subcategoriasEstructuradas.push({ ...sub, productos: productosConPresentaciones });
            }

            menu.push({ ...categoria, subcategorias: subcategoriasEstructuradas });
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
        const nombre = String(req.body.nombre || '').trim();
        const tipo = req.body.tipo || 'tamaño';
        const cantidad = req.body.cantidad || null;

        if (!nombre) {
            return res.status(400).json({ error: 'El nombre es requerido' });
        }

        const now = new Date().toISOString();
        const result = await database.run(`
            INSERT INTO presentaciones (nombre, tipo, cantidad, activo, creado_en, actualizado_en)
            VALUES (?, ?, ?, 1, ?, ?)
        `, [nombre, tipo, cantidad, now, now]);

        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            ['crear_presentacion', req.session.userId, `Presentación ${nombre} creada`, now]
        );

        res.json({
            success: true,
            data: { id: result.id, nombre, tipo, cantidad, activo: 1 }
        });
    } catch (error) {
        if (error.message && error.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ error: 'Ya existe una presentación con ese nombre' });
        }
        console.error('Error al crear presentación global:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

router.delete('/presentaciones-globales/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const asociada = await database.get(
            'SELECT COUNT(*) as count FROM presentaciones_producto WHERE presentacion_id = ? AND activo = 1',
            [id]
        );

        if (asociada.count > 0) {
            await database.run('UPDATE presentaciones SET activo = 0, actualizado_en = ? WHERE id = ?', [new Date().toISOString(), id]);
        } else {
            const result = await database.run('DELETE FROM presentaciones WHERE id = ?', [id]);
            if (result.changes === 0) {
                return res.status(404).json({ error: 'Presentación no encontrada' });
            }
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Error al eliminar presentación:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

module.exports = router;
