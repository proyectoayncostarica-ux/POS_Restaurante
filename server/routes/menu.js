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

function isActive(value) {
    return Number(value ?? 1) === 1;
}

function normalizeUserType(value = '') {
    return String(value || '').trim().toLowerCase();
}

function isMenuAdmin(req) {
    const userType = normalizeUserType(req.session?.userType);
    return userType === 'administrador' || userType === 'admin';
}

function requireMenuAdmin(req, res, next) {
    if (isMenuAdmin(req)) {
        return next();
    }

    return res.status(403).json({
        error: 'Solo los administradores pueden administrar productos, categorías, precios y presentaciones del Menú'
    });
}

function shouldIncludeInactive(req) {
    if (!isMenuAdmin(req)) return false;
    return parseBoolean(req.query.include_inactive) || parseBoolean(req.query.includeInactive) || parseBoolean(req.query.include_invalid);
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

    if (!isActive(categoria.activa)) {
        return 'La categoría seleccionada está inactiva';
    }

    if (subcategoriaId) {
        const subcategoria = await database.get(
            'SELECT * FROM categorias WHERE id = ? AND parent_id = ?',
            [subcategoriaId, categoriaId]
        );
        if (!subcategoria) {
            return 'Subcategoría no válida para esta categoría';
        }

        if (!isActive(subcategoria.activa)) {
            return 'La subcategoría seleccionada está inactiva';
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
    const relacionActiva = Number(row.relacion_activa ?? row.activo) === 1 ? 1 : 0;
    const presentacionActiva = Number(row.presentacion_activa ?? 1) === 1 ? 1 : 0;
    const bloqueos = [];

    if (!presentacionActiva) bloqueos.push('Presentación global inactiva');
    if (!relacionActiva) bloqueos.push('Presentación desactivada para este producto');
    if (precio <= 0) bloqueos.push('Presentación sin precio operativo válido');

    const disponible = relacionActiva === 1 && presentacionActiva === 1 && precio > 0 ? 1 : 0;

    return {
        id: Number(row.presentacion_id || row.id),
        presentacion_id: Number(row.presentacion_id || row.id),
        producto_presentacion_id: row.producto_presentacion_id ? Number(row.producto_presentacion_id) : null,
        nombre: row.nombre,
        tipo: row.tipo || 'tamaño',
        cantidad: row.cantidad || null,
        precio,
        precio_operativo: disponible ? precio : null,
        precio_configurado: precio,
        activo: relacionActiva,
        relacion_activa: relacionActiva,
        presentacion_activa: presentacionActiva,
        imagen: row.imagen || null,
        disponible_operacion: disponible,
        bloqueos_operativos: bloqueos
    };
}

function normalizePresentationSelectionInput(rawPresentations) {
    const input = Array.isArray(rawPresentations) ? rawPresentations : parseArray(rawPresentations);
    const normalized = [];
    const seen = new Set();
    const errors = [];

    input.forEach((item, index) => {
        const presentacionId = parseNumber(item?.presentacion_id ?? item?.id);
        const precio = parseNumber(item?.precio, NaN);

        if (!presentacionId && (item?.precio === undefined || item?.precio === null || item?.precio === '')) {
            return;
        }

        if (!presentacionId) {
            errors.push(`Presentación #${index + 1} sin identificador válido`);
            return;
        }

        if (seen.has(presentacionId)) {
            errors.push(`La presentación ${presentacionId} está duplicada para el producto`);
            return;
        }

        if (!Number.isFinite(precio) || precio <= 0) {
            errors.push(`La presentación ${presentacionId} requiere un precio mayor a cero`);
            return;
        }

        seen.add(presentacionId);
        normalized.push({ presentacion_id: presentacionId, precio });
    });

    return { normalized, errors };
}

async function validatePresentationSelection(rawPresentations, options = {}) {
    const requireAtLeastOne = options.requireAtLeastOne === true;
    const { normalized, errors } = normalizePresentationSelectionInput(rawPresentations);

    if (requireAtLeastOne && normalized.length === 0) {
        errors.push('Debe seleccionar al menos una presentación con precio mayor a cero');
    }

    if (errors.length > 0) {
        return { ok: false, error: errors[0], errors, presentaciones: [] };
    }

    if (normalized.length === 0) {
        return { ok: true, presentaciones: [] };
    }

    const ids = normalized.map(item => item.presentacion_id);
    const placeholders = ids.map(() => '?').join(',');
    const rows = await database.all(`
        SELECT id, nombre, activo
        FROM presentaciones
        WHERE id IN (${placeholders})
    `, ids);

    const rowsById = new Map(rows.map(row => [Number(row.id), row]));
    for (const item of normalized) {
        const presentacion = rowsById.get(item.presentacion_id);
        if (!presentacion) {
            return {
                ok: false,
                error: `La presentación ${item.presentacion_id} no existe`,
                errors: [`La presentación ${item.presentacion_id} no existe`],
                presentaciones: []
            };
        }
        if (Number(presentacion.activo) !== 1) {
            return {
                ok: false,
                error: `La presentación ${presentacion.nombre} está inactiva`,
                errors: [`La presentación ${presentacion.nombre} está inactiva`],
                presentaciones: []
            };
        }
    }

    return { ok: true, presentaciones: normalized };
}

async function upsertProductPresentations(productoId, presentaciones) {
    const presentacionesAsignadasIds = [];

    for (const presentacion of presentaciones) {
        const existente = await database.get(`
            SELECT id FROM presentaciones_producto
            WHERE producto_id = ? AND presentacion_id = ?
        `, [productoId, presentacion.presentacion_id]);

        if (existente) {
            await database.run(`
                UPDATE presentaciones_producto
                SET precio = ?, activo = 1, actualizado_en = CURRENT_TIMESTAMP
                WHERE id = ?
            `, [presentacion.precio, existente.id]);
        } else {
            await database.run(`
                INSERT INTO presentaciones_producto (producto_id, presentacion_id, precio, activo, creado_en, actualizado_en)
                VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `, [productoId, presentacion.presentacion_id, presentacion.precio]);
        }

        presentacionesAsignadasIds.push(presentacion.presentacion_id);
    }

    if (presentacionesAsignadasIds.length > 0) {
        const placeholders = presentacionesAsignadasIds.map(() => '?').join(',');
        await database.run(`
            UPDATE presentaciones_producto
            SET activo = 0, actualizado_en = CURRENT_TIMESTAMP
            WHERE producto_id = ? AND presentacion_id NOT IN (${placeholders})
        `, [productoId, ...presentacionesAsignadasIds]);
    } else {
        await database.run(`
            UPDATE presentaciones_producto
            SET activo = 0, actualizado_en = CURRENT_TIMESTAMP
            WHERE producto_id = ?
        `, [productoId]);
    }
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
            activa: isActive(category.activa) ? 1 : 0,
            disponible_operacion: isActive(category.activa) ? 1 : 0,
            total_productos_operativos: counters.get(Number(category.id)) || 0
        }))
        .filter(category => (includeEmpty || category.activa === 1) && (includeEmpty || category.total_productos_operativos > 0 || category.tipo === 'principal'));
}

async function buildOperationalMenuPayload(options = {}) {
    const includeInvalid = options.includeInvalid === true;
    const includeEmptyCategories = options.includeEmptyCategories === true;

    const categories = await database.all(`
        SELECT c.id, c.nombre, c.parent_id, c.permite_cocina, COALESCE(c.activa, 1) AS activa, p.nombre AS categoria_padre, COALESCE(p.activa, 1) AS categoria_padre_activa
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
            COALESCE(p.activo, 1) AS activo,
            c.nombre AS categoria_nombre,
            c.permite_cocina AS categoria_permite_cocina,
            COALESCE(c.activa, 1) AS categoria_activa,
            s.nombre AS subcategoria_nombre,
            s.permite_cocina AS subcategoria_permite_cocina,
            COALESCE(s.activa, 1) AS subcategoria_activa
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
            pp.activo AS relacion_activa,
            pr.activo AS presentacion_activa,
            pp.imagen
        FROM presentaciones_producto pp
        JOIN presentaciones pr ON pp.presentacion_id = pr.id
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
        const presentacionesConfiguradas = presentationsByProduct.get(productId) || [];
        const presentacionesValidas = presentacionesConfiguradas.filter(presentation => presentation.disponible_operacion === 1);
        const tienePresentacionesConfiguradas = presentacionesConfiguradas.length > 0;
        const tienePresentacionesOperativas = presentacionesValidas.length > 0;
        const bloqueos = [];
        if (!isActive(product.activo)) bloqueos.push('Producto inactivo');
        if (!isActive(product.categoria_activa)) bloqueos.push('Categoría inactiva');
        if (product.subcategoria_id && !isActive(product.subcategoria_activa)) bloqueos.push('Subcategoría inactiva');
        let precioOperativo = null;
        let origenPrecio = tienePresentacionesConfiguradas ? 'presentacion' : 'producto';
        let precioMinimo = null;
        let precioMaximo = null;

        if (tienePresentacionesConfiguradas) {
            if (tienePresentacionesOperativas) {
                const precios = presentacionesValidas.map(presentation => presentation.precio_operativo);
                precioMinimo = Math.min(...precios);
                precioMaximo = Math.max(...precios);
            } else {
                bloqueos.push('Producto con presentaciones sin precio operativo válido');
            }

            presentacionesConfiguradas.forEach(presentation => {
                if (presentation.disponible_operacion !== 1 && presentation.bloqueos_operativos?.length) {
                    presentation.bloqueos_operativos.forEach(reason => {
                        const detalle = `${presentation.nombre}: ${reason}`;
                        if (!bloqueos.includes(detalle)) bloqueos.push(detalle);
                    });
                }
            });
        } else if (precioBase > 0) {
            precioOperativo = precioBase;
            precioMinimo = precioBase;
            precioMaximo = precioBase;
        } else {
            origenPrecio = 'sin_precio_valido';
            bloqueos.push('Producto sin precio operativo válido');
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
            activo: isActive(product.activo) ? 1 : 0,
            categoria_id: Number(product.categoria_id),
            categoria_nombre: product.categoria_nombre,
            categoria_activa: isActive(product.categoria_activa) ? 1 : 0,
            subcategoria_id: product.subcategoria_id ? Number(product.subcategoria_id) : null,
            subcategoria_nombre: product.subcategoria_nombre || null,
            subcategoria_activa: product.subcategoria_id ? (isActive(product.subcategoria_activa) ? 1 : 0) : null,
            categoria_operativa: categoriaNombre,
            es_cocina: Number(product.es_cocina) === 1 ? 1 : 0,
            requiere_comanda: Number(product.es_cocina) === 1 ? 1 : 0,
            tiene_presentaciones: tienePresentacionesOperativas ? 1 : 0,
            tiene_presentaciones_configuradas: tienePresentacionesConfiguradas ? 1 : 0,
            precio_base: precioBase,
            precio: precioOperativo ?? precioBase,
            precio_operativo: precioOperativo,
            precio_minimo: precioMinimo,
            precio_maximo: precioMaximo,
            origen_precio: origenPrecio,
            presentaciones: presentacionesValidas,
            presentaciones_diagnostico: includeInvalid ? presentacionesConfiguradas : undefined,
            total_presentaciones: presentacionesValidas.length,
            total_presentaciones_configuradas: presentacionesConfiguradas.length,
            disponible_operacion: operativo,
            bloqueos_operativos: bloqueos
        };
    });

    const operationalProducts = includeInvalid
        ? normalizedProducts
        : normalizedProducts.filter(product => product.disponible_operacion === 1);

    return {
        version_contrato: 'v2.2.5M.4',
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
        const includeInactive = shouldIncludeInactive(req);
        const categories = await database.all(`
            SELECT c.*, COALESCE(c.activa, 1) AS activa,
                   CASE WHEN c.parent_id IS NULL THEN 'principal' ELSE 'subcategoria' END as tipo,
                   p.nombre as categoria_padre,
                   COALESCE(p.activa, 1) AS categoria_padre_activa
            FROM categorias c
            LEFT JOIN categorias p ON c.parent_id = p.id
            WHERE (? = 1 OR COALESCE(c.activa, 1) = 1)
            ORDER BY COALESCE(c.activa, 1) DESC, c.parent_id, c.nombre
        `, [includeInactive ? 1 : 0]);

        res.json({ success: true, data: categories });
    } catch (error) {
        console.error('Error obteniendo categorías:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Crear nueva categoría
router.post('/categories', requireMenuAdmin, async (req, res) => {
    try {
        const { nombre, parent_id, permite_cocina, activa } = req.body;
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
            const parentCategory = await database.get('SELECT id, activa FROM categorias WHERE id = ?', [parentId]);
            if (!parentCategory) {
                return res.status(400).json({ error: 'Categoría padre no encontrada' });
            }
            if (!isActive(parentCategory.activa)) {
                return res.status(400).json({ error: 'No se puede crear una subcategoría dentro de una categoría inactiva' });
            }
        }

        const result = await database.run(
            'INSERT INTO categorias (nombre, parent_id, permite_cocina, activa) VALUES (?, ?, ?, ?)',
            [nombreLimpio, parentId, parseBoolean(permite_cocina) ? 1 : 0, activa === undefined ? 1 : (parseBoolean(activa) ? 1 : 0)]
        );

        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            ['crear_categoria', req.session.userId, `Categoría ${nombreLimpio} creada`, new Date().toISOString()]
        );

        res.json({
            success: true,
            data: { id: result.id, nombre: nombreLimpio, parent_id: parentId, permite_cocina: parseBoolean(permite_cocina) ? 1 : 0, activa: activa === undefined ? 1 : (parseBoolean(activa) ? 1 : 0) }
        });
    } catch (error) {
        console.error('Error creando categoría:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Actualizar categoría o subcategoría
router.put('/categories/:id', requireMenuAdmin, async (req, res) => {
    const { id } = req.params;

    try {
        const categoria = await database.get('SELECT * FROM categorias WHERE id = ?', [id]);
        if (!categoria) {
            return res.status(404).json({ error: 'Categoría no encontrada' });
        }

        const nombre = req.body.nombre !== undefined ? String(req.body.nombre || '').trim() : categoria.nombre;
        const permiteCocina = req.body.permite_cocina !== undefined ? (parseBoolean(req.body.permite_cocina) ? 1 : 0) : Number(categoria.permite_cocina || 0);
        const activa = req.body.activa !== undefined || req.body.activo !== undefined
            ? (parseBoolean(req.body.activa ?? req.body.activo) ? 1 : 0)
            : isActive(categoria.activa) ? 1 : 0;

        if (!nombre) {
            return res.status(400).json({ error: 'Nombre de categoría es requerido' });
        }

        const duplicate = await database.get('SELECT id FROM categorias WHERE nombre = ? AND id != ?', [nombre, id]);
        if (duplicate) {
            return res.status(400).json({ error: 'Ya existe una categoría con ese nombre' });
        }

        await database.run(`
            UPDATE categorias
            SET nombre = ?, permite_cocina = ?, activa = ?
            WHERE id = ?
        `, [nombre, permiteCocina, activa, id]);

        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            ['actualizar_categoria', req.session.userId, `Categoría ${nombre} actualizada (${activa ? 'activa' : 'inactiva'})`, new Date().toISOString()]
        );

        res.json({ success: true, message: 'Categoría actualizada correctamente', data: { id: Number(id), nombre, permite_cocina: permiteCocina, activa } });
    } catch (error) {
        console.error('Error actualizando categoría:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Eliminar categoría o subcategoría
// En v2.2.5M.4 la eliminación operativa se convierte en desactivación segura.
router.delete('/categories/:id', requireMenuAdmin, async (req, res) => {
    const { id } = req.params;

    try {
        const categoria = await database.get('SELECT * FROM categorias WHERE id = ?', [id]);
        if (!categoria) {
            return res.status(404).json({ error: 'Categoría no encontrada' });
        }

        await database.run('UPDATE categorias SET activa = 0 WHERE id = ?', [id]);
        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            ['desactivar_categoria', req.session.userId, `Categoría "${categoria.nombre}" desactivada`, new Date().toISOString()]
        );

        res.json({ success: true, message: 'Categoría desactivada correctamente' });
    } catch (error) {
        console.error('Error desactivando categoría:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});




// Obtener productos normalizados para operación de Cuentas/Orders
router.get('/operational-products', async (req, res) => {
    try {
        const includeInvalid = isMenuAdmin(req) && parseBoolean(req.query.include_invalid);
        const includeEmptyCategories = isMenuAdmin(req) && parseBoolean(req.query.include_empty_categories);
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
        const includeInactive = shouldIncludeInactive(req);
        const products = await database.all(`
            SELECT 
                p.*,
                COALESCE(p.activo, 1) AS activo,
                c.nombre as categoria_nombre,
                COALESCE(c.activa, 1) AS categoria_activa,
                s.nombre as subcategoria_nombre,
                COALESCE(s.activa, 1) AS subcategoria_activa,
                EXISTS (
                    SELECT 1
                    FROM presentaciones_producto pp
                    JOIN presentaciones pr ON pp.presentacion_id = pr.id
                    WHERE pp.producto_id = p.id
                      AND COALESCE(pp.activo, 1) = 1
                      AND COALESCE(pr.activo, 1) = 1
                      AND COALESCE(pp.precio, 0) > 0
                ) AS tiene_presentaciones
            FROM productos p
            JOIN categorias c ON p.categoria_id = c.id
            LEFT JOIN categorias s ON p.subcategoria_id = s.id
            WHERE (? = 1 OR (COALESCE(p.activo, 1) = 1 AND COALESCE(c.activa, 1) = 1 AND (p.subcategoria_id IS NULL OR COALESCE(s.activa, 1) = 1)))
            ORDER BY COALESCE(p.activo, 1) DESC, c.nombre, s.nombre, p.nombre
        `, [includeInactive ? 1 : 0]);

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
        const includeInactive = shouldIncludeInactive(req);
        if (!q) {
            return res.status(400).json({ error: 'Término de búsqueda requerido' });
        }

        const products = await database.all(`
            SELECT p.*, COALESCE(p.activo, 1) AS activo, c.nombre as categoria_nombre, COALESCE(c.activa, 1) AS categoria_activa, s.nombre as subcategoria_nombre, COALESCE(s.activa, 1) AS subcategoria_activa,
                   EXISTS (
                       SELECT 1 FROM presentaciones_producto pp
                       JOIN presentaciones pr ON pp.presentacion_id = pr.id
                       WHERE pp.producto_id = p.id AND COALESCE(pp.activo, 1) = 1 AND COALESCE(pr.activo, 1) = 1 AND COALESCE(pp.precio, 0) > 0
                   ) AS tiene_presentaciones
            FROM productos p
            JOIN categorias c ON p.categoria_id = c.id
            LEFT JOIN categorias s ON p.subcategoria_id = s.id
            WHERE (p.nombre LIKE ? OR COALESCE(p.descripcion, '') LIKE ?)
              AND (? = 1 OR (COALESCE(p.activo, 1) = 1 AND COALESCE(c.activa, 1) = 1 AND (p.subcategoria_id IS NULL OR COALESCE(s.activa, 1) = 1)))
            ORDER BY p.nombre
        `, [`%${q}%`, `%${q}%`, includeInactive ? 1 : 0]);

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
                p.tipo,
                p.cantidad,
                p.activo AS presentacion_activa,
                pp.id AS producto_presentacion_id,
                pp.activo AS relacion_activa,
                COALESCE(pp.precio, 0) AS precio,
                CASE WHEN pp.id IS NOT NULL AND pp.activo = 1 THEN 1 ELSE 0 END AS asignada
            FROM presentaciones p
            LEFT JOIN presentaciones_producto pp
                ON pp.presentacion_id = p.id AND pp.producto_id = ?
            WHERE p.activo = 1
            ORDER BY p.nombre
        `, [id]);

        const presentacionesNormalizadas = presentaciones.map(row => {
            const normalizada = normalizePresentationForOperation(row);
            return {
                ...row,
                precio_operativo: normalizada.precio_operativo,
                disponible_operacion: normalizada.disponible_operacion,
                bloqueos_operativos: normalizada.bloqueos_operativos
            };
        });

        res.json({
            success: true,
            producto_nombre: producto.nombre,
            presentaciones: presentacionesNormalizadas,
            data: {
                producto_nombre: producto.nombre,
                presentaciones: presentacionesNormalizadas
            }
        });
    } catch (error) {
        console.error('Error obteniendo presentaciones del producto:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Crear nuevo producto
router.post('/products', requireMenuAdmin, subirImagen, async (req, res) => {
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
        const activo = req.body.activo === undefined ? 1 : (parseBoolean(req.body.activo) ? 1 : 0);

        if (!nombre || !categoriaId || (!tienePresentaciones && (!Number.isFinite(precio) || precio <= 0))) {
            return res.status(400).json({ error: 'Nombre, precio (o presentaciones) y categoría son requeridos' });
        }

        const presentacionesValidadas = tienePresentaciones
            ? await validatePresentationSelection(presentacionesSeleccionadas, { requireAtLeastOne: true })
            : { ok: true, presentaciones: [] };

        if (!presentacionesValidadas.ok) {
            return res.status(400).json({ error: presentacionesValidadas.error });
        }

        const categoriaError = await validarCategoria(categoriaId, subcategoriaId, esCocina);
        if (categoriaError) {
            return res.status(400).json({ error: categoriaError });
        }

        await database.run('BEGIN');
        transactionStarted = true;

        const result = await database.run(
            `INSERT INTO productos (nombre, descripcion, precio, categoria_id, subcategoria_id, es_cocina, imagen, activo)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [nombre, descripcion, Number.isFinite(precio) ? precio : 0, categoriaId, subcategoriaId, esCocina ? 1 : 0, imagen, activo]
        );

        const productoId = result.id;

        if (tienePresentaciones) {
            await upsertProductPresentations(productoId, presentacionesValidadas.presentaciones);
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
                activo,
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
router.put('/products/:id', requireMenuAdmin, subirImagen, async (req, res) => {
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
        const tienePresentaciones = parseBoolean(req.body.tiene_presentaciones) || req.body.presentaciones !== undefined;
        const presentaciones = req.body.presentaciones !== undefined
            ? parseArray(req.body.presentaciones)
            : parseArray(req.body.presentaciones_seleccionadas);
        const precio = tienePresentaciones ? 0 : parseNumber(req.body.precio, producto.precio || 0);
        const imagen = uploadedImagePath(req) || producto.imagen || null;
        const activo = req.body.activo === undefined ? (isActive(producto.activo) ? 1 : 0) : (parseBoolean(req.body.activo) ? 1 : 0);

        if (!nombre || !categoriaId || (!tienePresentaciones && (!Number.isFinite(precio) || precio <= 0))) {
            return res.status(400).json({ error: 'Nombre, categoría y precio válido son requeridos' });
        }

        const presentacionesValidadas = tienePresentaciones
            ? await validatePresentationSelection(presentaciones, { requireAtLeastOne: true })
            : { ok: true, presentaciones: [] };

        if (!presentacionesValidadas.ok) {
            return res.status(400).json({ error: presentacionesValidadas.error });
        }

        const categoriaError = await validarCategoria(categoriaId, subcategoriaId, esCocina);
        if (categoriaError) {
            return res.status(400).json({ error: categoriaError });
        }

        await database.run('BEGIN');
        transactionStarted = true;

        await database.run(`
            UPDATE productos
            SET nombre = ?, descripcion = ?, precio = ?, categoria_id = ?, subcategoria_id = ?, es_cocina = ?, imagen = ?, activo = ?
            WHERE id = ?
        `, [nombre, descripcion, precio, categoriaId, subcategoriaId, esCocina ? 1 : 0, imagen, activo, id]);

        await upsertProductPresentations(id, tienePresentaciones ? presentacionesValidadas.presentaciones : []);

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

// Cambiar estado activo/inactivo de producto
router.put('/products/:id/active', requireMenuAdmin, async (req, res) => {
    const { id } = req.params;

    try {
        const producto = await database.get('SELECT * FROM productos WHERE id = ?', [id]);
        if (!producto) {
            return res.status(404).json({ error: 'Producto no encontrado' });
        }

        const activo = parseBoolean(req.body.activo) ? 1 : 0;
        await database.run('UPDATE productos SET activo = ? WHERE id = ?', [activo, id]);
        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            [activo ? 'activar_producto' : 'desactivar_producto', req.session.userId, `Producto ${producto.nombre} ${activo ? 'activado' : 'desactivado'}`, new Date().toISOString()]
        );

        res.json({ success: true, message: `Producto ${activo ? 'activado' : 'desactivado'} correctamente`, data: { id: Number(id), activo } });
    } catch (error) {
        console.error('Error cambiando estado del producto:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Eliminar producto
// En v2.2.5M.4 el delete operativo desactiva para conservar historial.
router.delete('/products/:id', requireMenuAdmin, async (req, res) => {
    const { id } = req.params;

    try {
        const producto = await database.get('SELECT * FROM productos WHERE id = ?', [id]);
        if (!producto) {
            return res.status(404).json({ error: 'Producto no encontrado' });
        }

        await database.run('UPDATE productos SET activo = 0 WHERE id = ?', [id]);
        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            ['desactivar_producto', req.session.userId, `Producto ${producto.nombre} desactivado`, new Date().toISOString()]
        );

        res.json({ success: true, message: 'Producto desactivado correctamente' });
    } catch (error) {
        console.error('Error desactivando producto:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});


// Obtener menú completo organizado por categoría > subcategoría > productos > presentaciones
router.get('/completo', async (req, res) => {
    try {
        const categorias = await database.all('SELECT * FROM categorias WHERE parent_id IS NULL AND COALESCE(activa, 1) = 1 ORDER BY nombre');
        const menu = [];

        for (const categoria of categorias) {
            const subcategorias = await database.all(
                'SELECT * FROM categorias WHERE parent_id = ? AND COALESCE(activa, 1) = 1 ORDER BY nombre',
                [categoria.id]
            );

            const subcategoriasEstructuradas = [];
            for (const sub of subcategorias) {
                const productos = await database.all(
                    'SELECT * FROM productos WHERE categoria_id = ? AND subcategoria_id = ? AND COALESCE(activo, 1) = 1 ORDER BY nombre',
                    [categoria.id, sub.id]
                );

                const productosConPresentaciones = [];
                for (const prod of productos) {
                    const presentaciones = await database.all(`
                        SELECT pp.id, pp.presentacion_id, p.nombre, p.tipo, p.cantidad, pp.precio, pp.activo, p.activo AS presentacion_activa
                        FROM presentaciones_producto pp
                        JOIN presentaciones p ON pp.presentacion_id = p.id
                        WHERE pp.producto_id = ? AND pp.activo = 1 AND p.activo = 1 AND pp.precio > 0
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
        const includeInactive = shouldIncludeInactive(req);
        const presentaciones = await database.all(`
            SELECT id, nombre, tipo, cantidad, COALESCE(activo, 1) AS activo
            FROM presentaciones
            WHERE (? = 1 OR COALESCE(activo, 1) = 1)
            ORDER BY COALESCE(activo, 1) DESC, nombre ASC
        `, [includeInactive ? 1 : 0]);

        res.json({ success: true, data: presentaciones });
    } catch (error) {
        console.error('Error al obtener presentaciones globales:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});


router.post('/presentaciones-globales', requireMenuAdmin, async (req, res) => {
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

router.put('/presentaciones-globales/:id', requireMenuAdmin, async (req, res) => {
    const { id } = req.params;

    try {
        const presentacion = await database.get('SELECT * FROM presentaciones WHERE id = ?', [id]);
        if (!presentacion) {
            return res.status(404).json({ error: 'Presentación no encontrada' });
        }

        const nombre = req.body.nombre !== undefined ? String(req.body.nombre || '').trim() : presentacion.nombre;
        const tipo = req.body.tipo !== undefined ? (req.body.tipo || 'tamaño') : (presentacion.tipo || 'tamaño');
        const cantidad = req.body.cantidad !== undefined ? (req.body.cantidad || null) : presentacion.cantidad;
        const activo = req.body.activo !== undefined ? (parseBoolean(req.body.activo) ? 1 : 0) : (isActive(presentacion.activo) ? 1 : 0);

        if (!nombre) {
            return res.status(400).json({ error: 'El nombre es requerido' });
        }

        await database.run(`
            UPDATE presentaciones
            SET nombre = ?, tipo = ?, cantidad = ?, activo = ?, actualizado_en = ?
            WHERE id = ?
        `, [nombre, tipo, cantidad, activo, new Date().toISOString(), id]);

        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            ['actualizar_presentacion', req.session.userId, `Presentación ${nombre} actualizada (${activo ? 'activa' : 'inactiva'})`, new Date().toISOString()]
        );

        res.json({ success: true, data: { id: Number(id), nombre, tipo, cantidad, activo } });
    } catch (error) {
        if (error.message && error.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ error: 'Ya existe una presentación con ese nombre' });
        }
        console.error('Error al actualizar presentación global:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

router.put('/presentaciones-globales/:id/active', requireMenuAdmin, async (req, res) => {
    const { id } = req.params;

    try {
        const presentacion = await database.get('SELECT * FROM presentaciones WHERE id = ?', [id]);
        if (!presentacion) {
            return res.status(404).json({ error: 'Presentación no encontrada' });
        }

        const activo = parseBoolean(req.body.activo) ? 1 : 0;
        await database.run('UPDATE presentaciones SET activo = ?, actualizado_en = ? WHERE id = ?', [activo, new Date().toISOString(), id]);
        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            [activo ? 'activar_presentacion' : 'desactivar_presentacion', req.session.userId, `Presentación ${presentacion.nombre} ${activo ? 'activada' : 'desactivada'}`, new Date().toISOString()]
        );

        res.json({ success: true, message: `Presentación ${activo ? 'activada' : 'desactivada'} correctamente`, data: { id: Number(id), activo } });
    } catch (error) {
        console.error('Error cambiando estado de presentación:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

router.delete('/presentaciones-globales/:id', requireMenuAdmin, async (req, res) => {
    const { id } = req.params;

    try {
        const presentacion = await database.get('SELECT * FROM presentaciones WHERE id = ?', [id]);
        if (!presentacion) {
            return res.status(404).json({ error: 'Presentación no encontrada' });
        }

        await database.run('UPDATE presentaciones SET activo = 0, actualizado_en = ? WHERE id = ?', [new Date().toISOString(), id]);
        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            ['desactivar_presentacion', req.session.userId, `Presentación ${presentacion.nombre} desactivada`, new Date().toISOString()]
        );

        res.json({ success: true, message: 'Presentación desactivada correctamente' });
    } catch (error) {
        console.error('Error al desactivar presentación:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});


module.exports = router;
