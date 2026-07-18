const express = require('express');
const database = require('../db/database');
const fs = require('fs');
const multer = require('multer');
const path = require('path');
const zlib = require('zlib');
const requireCapability = require('../middleware/requireCapability');
const { CAPABILITIES } = require('../security/capabilities');

const router = express.Router();

// Menú operativo solo está disponible para sesiones con capacidad de atención.
// Las mutaciones siguen protegidas adicionalmente por administración dentro de este router.
router.use(requireCapability(CAPABILITIES.ORDERS_OPERATE));
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

function subirImagenesProducto(req, res, next) {
    upload.any()(req, res, (err) => {
        if (err instanceof multer.MulterError) {
            return res.status(400).json({ error: `Error al subir imágenes: ${err.message}` });
        }
        if (err) {
            return res.status(400).json({ error: err.message || 'Error al procesar las imágenes' });
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

function normalizePreparationDestination(value, legacyKitchen = false) {
    const normalized = String(value || '').trim().toLowerCase();
    if (['ninguno', 'cocina', 'bar'].includes(normalized)) return normalized;
    return legacyKitchen ? 'cocina' : 'ninguno';
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

function uploadedImagePath(req, fieldName = 'imagen') {
    if (req.file && (!fieldName || req.file.fieldname === fieldName)) {
        return `/uploads/productos/${req.file.filename}`;
    }

    if (Array.isArray(req.files)) {
        const file = req.files.find(item => item.fieldname === fieldName);
        return file ? `/uploads/productos/${file.filename}` : null;
    }

    if (req.files && req.files[fieldName]?.[0]) {
        return `/uploads/productos/${req.files[fieldName][0].filename}`;
    }

    return null;
}

function uploadedPresentationImages(req) {
    const files = Array.isArray(req.files) ? req.files : [];
    const images = new Map();

    files.forEach(file => {
        const match = String(file.fieldname || '').match(/^imagen_presentacion_(\d+)$/);
        if (match) {
            images.set(Number(match[1]), `/uploads/productos/${file.filename}`);
        }
    });

    return images;
}

async function validarCategoria(categoriaId, subcategoriaId, destinoPreparacion = 'ninguno') {
    const requiereCocina = destinoPreparacion === 'cocina';
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

        if (requiereCocina && !subcategoria.permite_cocina && !categoria.permite_cocina) {
            return 'Esta combinación de categoría/subcategoría no permite productos de cocina';
        }
    } else if (requiereCocina && !categoria.permite_cocina) {
        return 'Esta categoría no permite productos de cocina';
    }

    return null;
}


async function validarTipoPresentacionParaProducto(tipoPresentacionId, categoriaId, subcategoriaId) {
    if (!tipoPresentacionId) {
        return { ok: false, error: 'Debe seleccionar un tipo/grupo de presentación' };
    }

    const tipo = await database.get(`
        SELECT
            tp.*,
            c.nombre AS categoria_nombre,
            COALESCE(c.activa, 1) AS categoria_activa,
            s.nombre AS subcategoria_nombre,
            COALESCE(s.activa, 1) AS subcategoria_activa
        FROM tipos_presentacion tp
        JOIN categorias c ON tp.categoria_id = c.id
        LEFT JOIN categorias s ON tp.subcategoria_id = s.id
        WHERE tp.id = ?
    `, [tipoPresentacionId]);

    if (!tipo) {
        return { ok: false, error: 'Tipo/grupo de presentación no encontrado' };
    }

    if (!isActive(tipo.activo)) {
        return { ok: false, error: 'El tipo/grupo de presentación seleccionado está inactivo' };
    }

    if (!isActive(tipo.categoria_activa)) {
        return { ok: false, error: 'La categoría del tipo/grupo de presentación está inactiva' };
    }

    if (tipo.subcategoria_id && !isActive(tipo.subcategoria_activa)) {
        return { ok: false, error: 'La subcategoría del tipo/grupo de presentación está inactiva' };
    }

    if (Number(tipo.categoria_id) !== Number(categoriaId)) {
        return { ok: false, error: 'El tipo/grupo de presentación no pertenece a la categoría del producto' };
    }

    if (tipo.subcategoria_id && Number(tipo.subcategoria_id) !== Number(subcategoriaId || 0)) {
        return { ok: false, error: 'El tipo/grupo de presentación no pertenece a la subcategoría del producto' };
    }

    return { ok: true, tipo };
}

async function validarTipoPresentacionParaPresentacion(tipoPresentacionId) {
    if (!tipoPresentacionId) {
        return { ok: false, error: 'Debe seleccionar un tipo/grupo de presentación' };
    }

    const tipo = await database.get(`
        SELECT tp.*, c.nombre AS categoria_nombre, s.nombre AS subcategoria_nombre
        FROM tipos_presentacion tp
        JOIN categorias c ON tp.categoria_id = c.id
        LEFT JOIN categorias s ON tp.subcategoria_id = s.id
        WHERE tp.id = ?
    `, [tipoPresentacionId]);

    if (!tipo) {
        return { ok: false, error: 'Tipo/grupo de presentación no encontrado' };
    }

    if (!isActive(tipo.activo)) {
        return { ok: false, error: 'El tipo/grupo de presentación seleccionado está inactivo' };
    }

    return { ok: true, tipo };
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
        tipo_presentacion_id: row.tipo_presentacion_id ? Number(row.tipo_presentacion_id) : null,
        tipo_presentacion_nombre: row.tipo_presentacion_nombre || null,
        precio,
        precio_operativo: disponible ? precio : null,
        precio_configurado: precio,
        activo: relacionActiva,
        relacion_activa: relacionActiva,
        presentacion_activa: presentacionActiva,
        imagen: row.imagen || row.producto_imagen || null,
        imagen_url: row.imagen || row.producto_imagen || null,
        imagen_origen: row.imagen ? 'presentacion' : (row.producto_imagen ? 'producto' : 'generica'),
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
    const tipoPresentacionId = parseNumber(options.tipoPresentacionId, null);
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
        SELECT id, nombre, activo, tipo_presentacion_id
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

        if (tipoPresentacionId && Number(presentacion.tipo_presentacion_id || 0) !== Number(tipoPresentacionId)) {
            return {
                ok: false,
                error: `La presentación ${presentacion.nombre} no pertenece al tipo/grupo seleccionado`,
                errors: [`La presentación ${presentacion.nombre} no pertenece al tipo/grupo seleccionado`],
                presentaciones: []
            };
        }
    }

    return { ok: true, presentaciones: normalized };
}

async function upsertProductPresentations(productoId, presentaciones, imageByPresentationId = new Map()) {
    const presentacionesAsignadasIds = [];

    for (const presentacion of presentaciones) {
        const presentacionId = Number(presentacion.presentacion_id);
        const imagenPresentacion = presentacion.imagen || imageByPresentationId.get(presentacionId) || null;
        const existente = await database.get(`
            SELECT id FROM presentaciones_producto
            WHERE producto_id = ? AND presentacion_id = ?
        `, [productoId, presentacionId]);

        if (existente) {
            await database.run(`
                UPDATE presentaciones_producto
                SET precio = ?, activo = 1, imagen = COALESCE(?, imagen), actualizado_en = CURRENT_TIMESTAMP
                WHERE id = ?
            `, [presentacion.precio, imagenPresentacion, existente.id]);
        } else {
            await database.run(`
                INSERT INTO presentaciones_producto (producto_id, presentacion_id, precio, activo, imagen, creado_en, actualizado_en)
                VALUES (?, ?, ?, 1, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `, [productoId, presentacionId, presentacion.precio, imagenPresentacion]);
        }

        presentacionesAsignadasIds.push(presentacionId);
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
            p.destino_preparacion,
            p.imagen,
            p.tipo_presentacion_id,
            tp.nombre AS tipo_presentacion_nombre,
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
        LEFT JOIN tipos_presentacion tp ON p.tipo_presentacion_id = tp.id
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
            pr.tipo_presentacion_id,
            tp.nombre AS tipo_presentacion_nombre,
            COALESCE(pp.precio, 0) AS precio,
            pp.activo AS relacion_activa,
            pr.activo AS presentacion_activa,
            pp.imagen,
            prod.imagen AS producto_imagen
        FROM presentaciones_producto pp
        JOIN productos prod ON pp.producto_id = prod.id
        JOIN presentaciones pr ON pp.presentacion_id = pr.id
        LEFT JOIN tipos_presentacion tp ON pr.tipo_presentacion_id = tp.id
        ORDER BY tp.nombre, pr.nombre
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
        const productBaseImage = normalizeProductImage(product);
        const presentationImage = tienePresentacionesOperativas
            ? presentacionesValidas.find(presentation => presentation.imagen)?.imagen || null
            : null;
        const operationalImage = presentationImage || productBaseImage;

        return {
            id: productId,
            producto_id: productId,
            nombre: product.nombre,
            descripcion: product.descripcion || '',
            imagen: operationalImage,
            imagen_url: operationalImage,
            imagen_producto: productBaseImage,
            imagen_origen: presentationImage ? 'presentacion' : (productBaseImage ? 'producto' : 'generica'),
            activo: isActive(product.activo) ? 1 : 0,
            categoria_id: Number(product.categoria_id),
            categoria_nombre: product.categoria_nombre,
            categoria_activa: isActive(product.categoria_activa) ? 1 : 0,
            subcategoria_id: product.subcategoria_id ? Number(product.subcategoria_id) : null,
            subcategoria_nombre: product.subcategoria_nombre || null,
            subcategoria_activa: product.subcategoria_id ? (isActive(product.subcategoria_activa) ? 1 : 0) : null,
            tipo_presentacion_id: product.tipo_presentacion_id ? Number(product.tipo_presentacion_id) : null,
            tipo_presentacion_nombre: product.tipo_presentacion_nombre || null,
            categoria_operativa: categoriaNombre,
            es_cocina: Number(product.es_cocina) === 1 ? 1 : 0,
            destino_preparacion: normalizePreparationDestination(
                product.destino_preparacion,
                Number(product.es_cocina) === 1
            ),
            requiere_comanda: normalizePreparationDestination(
                product.destino_preparacion,
                Number(product.es_cocina) === 1
            ) !== 'ninguno' ? 1 : 0,
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
        version_contrato: 'v3.3.0-kitchen',
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

// Obtener tipos/grupos de presentación
router.get('/presentation-types', async (req, res) => {
    try {
        const includeInactive = shouldIncludeInactive(req);
        const tipos = await database.all(`
            SELECT
                tp.id,
                tp.nombre,
                tp.descripcion,
                tp.categoria_id,
                tp.subcategoria_id,
                COALESCE(tp.activo, 1) AS activo,
                tp.creado_en,
                tp.actualizado_en,
                c.nombre AS categoria_nombre,
                COALESCE(c.activa, 1) AS categoria_activa,
                s.nombre AS subcategoria_nombre,
                COALESCE(s.activa, 1) AS subcategoria_activa,
                COUNT(p.id) AS total_presentaciones
            FROM tipos_presentacion tp
            JOIN categorias c ON tp.categoria_id = c.id
            LEFT JOIN categorias s ON tp.subcategoria_id = s.id
            LEFT JOIN presentaciones p ON p.tipo_presentacion_id = tp.id
            WHERE (? = 1 OR COALESCE(tp.activo, 1) = 1)
            GROUP BY tp.id
            ORDER BY COALESCE(tp.activo, 1) DESC, c.nombre, COALESCE(s.nombre, ''), tp.nombre
        `, [includeInactive ? 1 : 0]);

        res.json({ success: true, data: tipos });
    } catch (error) {
        console.error('Error obteniendo tipos/grupos de presentación:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Crear tipo/grupo de presentación
router.post('/presentation-types', requireMenuAdmin, async (req, res) => {
    try {
        const nombre = String(req.body.nombre || '').trim();
        const descripcion = req.body.descripcion || '';
        const categoriaId = parseNumber(req.body.categoria_id);
        const subcategoriaId = parseNumber(req.body.subcategoria_id, null);
        const activo = req.body.activo === undefined ? 1 : (parseBoolean(req.body.activo) ? 1 : 0);

        if (!nombre || !categoriaId) {
            return res.status(400).json({ error: 'Nombre y categoría son requeridos' });
        }

        const categoriaError = await validarCategoria(categoriaId, subcategoriaId, 'ninguno');
        if (categoriaError) {
            return res.status(400).json({ error: categoriaError });
        }

        const now = new Date().toISOString();
        const result = await database.run(`
            INSERT INTO tipos_presentacion (nombre, descripcion, categoria_id, subcategoria_id, activo, creado_en, actualizado_en)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [nombre, descripcion, categoriaId, subcategoriaId, activo, now, now]);

        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            ['crear_tipo_presentacion', req.session.userId, `Tipo/grupo de presentación ${nombre} creado`, now]
        );

        res.json({
            success: true,
            data: { id: result.id, nombre, descripcion, categoria_id: categoriaId, subcategoria_id: subcategoriaId, activo }
        });
    } catch (error) {
        if (error.message && error.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ error: 'Ya existe un tipo/grupo de presentación con ese nombre' });
        }
        console.error('Error creando tipo/grupo de presentación:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Actualizar tipo/grupo de presentación
router.put('/presentation-types/:id', requireMenuAdmin, async (req, res) => {
    const { id } = req.params;

    try {
        const tipo = await database.get('SELECT * FROM tipos_presentacion WHERE id = ?', [id]);
        if (!tipo) {
            return res.status(404).json({ error: 'Tipo/grupo de presentación no encontrado' });
        }

        const nombre = req.body.nombre !== undefined ? String(req.body.nombre || '').trim() : tipo.nombre;
        const descripcion = req.body.descripcion !== undefined ? (req.body.descripcion || '') : (tipo.descripcion || '');
        const categoriaId = parseNumber(req.body.categoria_id, tipo.categoria_id);
        const subcategoriaId = req.body.subcategoria_id !== undefined ? parseNumber(req.body.subcategoria_id, null) : (tipo.subcategoria_id || null);
        const activo = req.body.activo !== undefined || req.body.activa !== undefined
            ? (parseBoolean(req.body.activo ?? req.body.activa) ? 1 : 0)
            : (isActive(tipo.activo) ? 1 : 0);

        if (!nombre || !categoriaId) {
            return res.status(400).json({ error: 'Nombre y categoría son requeridos' });
        }

        const categoriaError = await validarCategoria(categoriaId, subcategoriaId, 'ninguno');
        if (categoriaError) {
            return res.status(400).json({ error: categoriaError });
        }

        const now = new Date().toISOString();
        await database.run(`
            UPDATE tipos_presentacion
            SET nombre = ?, descripcion = ?, categoria_id = ?, subcategoria_id = ?, activo = ?, actualizado_en = ?
            WHERE id = ?
        `, [nombre, descripcion, categoriaId, subcategoriaId, activo, now, id]);

        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            ['actualizar_tipo_presentacion', req.session.userId, `Tipo/grupo de presentación ${nombre} actualizado`, now]
        );

        res.json({
            success: true,
            data: { id: Number(id), nombre, descripcion, categoria_id: categoriaId, subcategoria_id: subcategoriaId, activo }
        });
    } catch (error) {
        if (error.message && error.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ error: 'Ya existe un tipo/grupo de presentación con ese nombre' });
        }
        console.error('Error actualizando tipo/grupo de presentación:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

router.put('/presentation-types/:id/active', requireMenuAdmin, async (req, res) => {
    const { id } = req.params;

    try {
        const tipo = await database.get('SELECT * FROM tipos_presentacion WHERE id = ?', [id]);
        if (!tipo) {
            return res.status(404).json({ error: 'Tipo/grupo de presentación no encontrado' });
        }

        const activo = parseBoolean(req.body.activo) ? 1 : 0;
        const now = new Date().toISOString();
        await database.run('UPDATE tipos_presentacion SET activo = ?, actualizado_en = ? WHERE id = ?', [activo, now, id]);

        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            [activo ? 'activar_tipo_presentacion' : 'desactivar_tipo_presentacion', req.session.userId, `Tipo/grupo de presentación ${tipo.nombre} ${activo ? 'activado' : 'desactivado'}`, now]
        );

        res.json({ success: true, data: { id: Number(id), activo } });
    } catch (error) {
        console.error('Error cambiando estado del tipo/grupo de presentación:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

router.delete('/presentation-types/:id', requireMenuAdmin, async (req, res) => {
    const { id } = req.params;

    try {
        const tipo = await database.get('SELECT * FROM tipos_presentacion WHERE id = ?', [id]);
        if (!tipo) {
            return res.status(404).json({ error: 'Tipo/grupo de presentación no encontrado' });
        }

        const now = new Date().toISOString();
        await database.run('UPDATE tipos_presentacion SET activo = 0, actualizado_en = ? WHERE id = ?', [now, id]);
        await database.run('UPDATE presentaciones SET activo = 0, actualizado_en = ? WHERE tipo_presentacion_id = ?', [now, id]);

        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            ['desactivar_tipo_presentacion', req.session.userId, `Tipo/grupo de presentación ${tipo.nombre} desactivado`, now]
        );

        res.json({ success: true, message: 'Tipo/grupo de presentación desactivado correctamente' });
    } catch (error) {
        console.error('Error desactivando tipo/grupo de presentación:', error);
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
                tp.nombre AS tipo_presentacion_nombre,
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
            LEFT JOIN tipos_presentacion tp ON p.tipo_presentacion_id = tp.id
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
            SELECT p.*, COALESCE(p.activo, 1) AS activo, c.nombre as categoria_nombre, COALESCE(c.activa, 1) AS categoria_activa, tp.nombre AS tipo_presentacion_nombre, s.nombre as subcategoria_nombre, COALESCE(s.activa, 1) AS subcategoria_activa,
                   EXISTS (
                       SELECT 1 FROM presentaciones_producto pp
                       JOIN presentaciones pr ON pp.presentacion_id = pr.id
                       WHERE pp.producto_id = p.id AND COALESCE(pp.activo, 1) = 1 AND COALESCE(pr.activo, 1) = 1 AND COALESCE(pp.precio, 0) > 0
                   ) AS tiene_presentaciones
            FROM productos p
            JOIN categorias c ON p.categoria_id = c.id
            LEFT JOIN categorias s ON p.subcategoria_id = s.id
            LEFT JOIN tipos_presentacion tp ON p.tipo_presentacion_id = tp.id
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
        const producto = await database.get('SELECT nombre, tipo_presentacion_id, imagen FROM productos WHERE id = ?', [id]);
        if (!producto) {
            return res.status(404).json({ error: 'Producto no encontrado' });
        }

        const tipoPresentacionId = parseNumber(req.query.tipo_presentacion_id, producto.tipo_presentacion_id || null);
        const presentaciones = await database.all(`
            SELECT
                p.id,
                p.id AS presentacion_id,
                p.nombre,
                p.tipo,
                p.cantidad,
                p.tipo_presentacion_id,
                tp.nombre AS tipo_presentacion_nombre,
                p.activo AS presentacion_activa,
                pp.id AS producto_presentacion_id,
                pp.activo AS relacion_activa,
                pp.imagen,
                ? AS producto_imagen,
                COALESCE(pp.precio, 0) AS precio,
                CASE WHEN pp.id IS NOT NULL AND pp.activo = 1 THEN 1 ELSE 0 END AS asignada
            FROM presentaciones p
            LEFT JOIN tipos_presentacion tp ON p.tipo_presentacion_id = tp.id
            LEFT JOIN presentaciones_producto pp
                ON pp.presentacion_id = p.id AND pp.producto_id = ?
            WHERE p.activo = 1
              AND (? IS NULL OR p.tipo_presentacion_id = ?)
            ORDER BY tp.nombre, p.nombre
        `, [producto.imagen || null, id, tipoPresentacionId, tipoPresentacionId]);

        const presentacionesNormalizadas = presentaciones.map(row => {
            const normalizada = normalizePresentationForOperation(row);
            return {
                ...row,
                imagen: normalizada.imagen,
                imagen_url: normalizada.imagen_url,
                imagen_origen: normalizada.imagen_origen,
                precio_operativo: normalizada.precio_operativo,
                disponible_operacion: normalizada.disponible_operacion,
                bloqueos_operativos: normalizada.bloqueos_operativos
            };
        });

        res.json({
            success: true,
            producto_nombre: producto.nombre,
            tipo_presentacion_id: tipoPresentacionId,
            presentaciones: presentacionesNormalizadas,
            data: {
                producto_nombre: producto.nombre,
                tipo_presentacion_id: tipoPresentacionId,
                presentaciones: presentacionesNormalizadas
            }
        });
    } catch (error) {
        console.error('Error obteniendo presentaciones del producto:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Crear nuevo producto
router.post('/products', requireMenuAdmin, subirImagenesProducto, async (req, res) => {
    let transactionStarted = false;

    try {
        const nombre = String(req.body.nombre || '').trim();
        const descripcion = req.body.descripcion || '';
        const categoriaId = parseNumber(req.body.categoria_id);
        const subcategoriaId = parseNumber(req.body.subcategoria_id, null);
        const destinoPreparacion = normalizePreparationDestination(
            req.body.destino_preparacion,
            parseBoolean(req.body.es_cocina)
        );
        const esCocina = destinoPreparacion !== 'ninguno';
        const tienePresentaciones = parseBoolean(req.body.tiene_presentaciones);
        const tipoPresentacionId = tienePresentaciones ? parseNumber(req.body.tipo_presentacion_id, null) : null;
        const presentacionesSeleccionadas = parseArray(req.body.presentaciones_seleccionadas);
        const precio = tienePresentaciones ? 0 : parseNumber(req.body.precio, NaN);
        const imagen = uploadedImagePath(req);
        const imagenesPorPresentacion = uploadedPresentationImages(req);
        const activo = req.body.activo === undefined ? 1 : (parseBoolean(req.body.activo) ? 1 : 0);

        if (!nombre || !categoriaId || (!tienePresentaciones && (!Number.isFinite(precio) || precio <= 0))) {
            return res.status(400).json({ error: 'Nombre, precio (o presentaciones) y categoría son requeridos' });
        }

        const tipoPresentacionValidado = tienePresentaciones
            ? await validarTipoPresentacionParaProducto(tipoPresentacionId, categoriaId, subcategoriaId)
            : { ok: true, tipo: null };

        if (!tipoPresentacionValidado.ok) {
            return res.status(400).json({ error: tipoPresentacionValidado.error });
        }

        const presentacionesValidadas = tienePresentaciones
            ? await validatePresentationSelection(presentacionesSeleccionadas, { requireAtLeastOne: true, tipoPresentacionId })
            : { ok: true, presentaciones: [] };

        if (!presentacionesValidadas.ok) {
            return res.status(400).json({ error: presentacionesValidadas.error });
        }

        const categoriaError = await validarCategoria(categoriaId, subcategoriaId, destinoPreparacion);
        if (categoriaError) {
            return res.status(400).json({ error: categoriaError });
        }

        await database.run('BEGIN');
        transactionStarted = true;

        const result = await database.run(
            `INSERT INTO productos (
                nombre, descripcion, precio, categoria_id, subcategoria_id,
                es_cocina, destino_preparacion, imagen, tipo_presentacion_id, activo
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                nombre, descripcion, Number.isFinite(precio) ? precio : 0,
                categoriaId, subcategoriaId, esCocina ? 1 : 0, destinoPreparacion,
                imagen, tipoPresentacionId, activo
            ]
        );

        const productoId = result.id;

        if (tienePresentaciones) {
            await upsertProductPresentations(productoId, presentacionesValidadas.presentaciones, imagenesPorPresentacion);
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
                destino_preparacion: destinoPreparacion,
                imagen,
                tipo_presentacion_id: tipoPresentacionId,
                tipo_presentacion_nombre: tipoPresentacionValidado.tipo?.nombre || null,
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
router.put('/products/:id', requireMenuAdmin, subirImagenesProducto, async (req, res) => {
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
        const hasDestinationField = Object.prototype.hasOwnProperty.call(req.body, 'destino_preparacion');
        const hasLegacyKitchenField = Object.prototype.hasOwnProperty.call(req.body, 'es_cocina');
        const destinoPreparacion = hasDestinationField
            ? normalizePreparationDestination(req.body.destino_preparacion, parseBoolean(req.body.es_cocina))
            : hasLegacyKitchenField
                ? normalizePreparationDestination(null, parseBoolean(req.body.es_cocina))
                : normalizePreparationDestination(producto.destino_preparacion, parseBoolean(producto.es_cocina));
        const esCocina = destinoPreparacion !== 'ninguno';
        const tienePresentaciones = parseBoolean(req.body.tiene_presentaciones) || req.body.presentaciones !== undefined;
        const tipoPresentacionId = tienePresentaciones
            ? parseNumber(req.body.tipo_presentacion_id, producto.tipo_presentacion_id || null)
            : null;
        const presentaciones = req.body.presentaciones !== undefined
            ? parseArray(req.body.presentaciones)
            : parseArray(req.body.presentaciones_seleccionadas);
        const precio = tienePresentaciones ? 0 : parseNumber(req.body.precio, producto.precio || 0);
        const imagen = uploadedImagePath(req) || producto.imagen || null;
        const imagenesPorPresentacion = uploadedPresentationImages(req);
        const activo = req.body.activo === undefined ? (isActive(producto.activo) ? 1 : 0) : (parseBoolean(req.body.activo) ? 1 : 0);

        if (!nombre || !categoriaId || (!tienePresentaciones && (!Number.isFinite(precio) || precio <= 0))) {
            return res.status(400).json({ error: 'Nombre, categoría y precio válido son requeridos' });
        }

        const tipoPresentacionValidado = tienePresentaciones
            ? await validarTipoPresentacionParaProducto(tipoPresentacionId, categoriaId, subcategoriaId)
            : { ok: true, tipo: null };

        if (!tipoPresentacionValidado.ok) {
            return res.status(400).json({ error: tipoPresentacionValidado.error });
        }

        const presentacionesValidadas = tienePresentaciones
            ? await validatePresentationSelection(presentaciones, { requireAtLeastOne: true, tipoPresentacionId })
            : { ok: true, presentaciones: [] };

        if (!presentacionesValidadas.ok) {
            return res.status(400).json({ error: presentacionesValidadas.error });
        }

        const categoriaError = await validarCategoria(categoriaId, subcategoriaId, destinoPreparacion);
        if (categoriaError) {
            return res.status(400).json({ error: categoriaError });
        }

        await database.run('BEGIN');
        transactionStarted = true;

        await database.run(`
            UPDATE productos
            SET nombre = ?, descripcion = ?, precio = ?, categoria_id = ?, subcategoria_id = ?,
                es_cocina = ?, destino_preparacion = ?, imagen = ?, tipo_presentacion_id = ?, activo = ?
            WHERE id = ?
        `, [
            nombre, descripcion, precio, categoriaId, subcategoriaId,
            esCocina ? 1 : 0, destinoPreparacion, imagen, tipoPresentacionId, activo, id
        ]);

        await upsertProductPresentations(id, tienePresentaciones ? presentacionesValidadas.presentaciones : [], imagenesPorPresentacion);

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
        const tipoPresentacionId = parseNumber(req.query.tipo_presentacion_id, null);
        const presentaciones = await database.all(`
            SELECT
                p.id,
                p.nombre,
                p.tipo,
                p.cantidad,
                p.tipo_presentacion_id,
                tp.nombre AS tipo_presentacion_nombre,
                tp.categoria_id AS tipo_categoria_id,
                tp.subcategoria_id AS tipo_subcategoria_id,
                COALESCE(p.activo, 1) AS activo
            FROM presentaciones p
            LEFT JOIN tipos_presentacion tp ON p.tipo_presentacion_id = tp.id
            WHERE (? = 1 OR COALESCE(p.activo, 1) = 1)
              AND (? IS NULL OR p.tipo_presentacion_id = ?)
            ORDER BY COALESCE(p.activo, 1) DESC, tp.nombre, p.nombre ASC
        `, [includeInactive ? 1 : 0, tipoPresentacionId, tipoPresentacionId]);

        res.json({ success: true, data: presentaciones });
    } catch (error) {
        console.error('Error al obtener presentaciones globales:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});


router.post('/presentaciones-globales', requireMenuAdmin, async (req, res) => {
    try {
        const nombre = String(req.body.nombre || '').trim();
        const tipoPresentacionId = parseNumber(req.body.tipo_presentacion_id, null);
        const tipo = req.body.tipo || 'tamaño';
        const cantidad = req.body.cantidad || null;

        if (!nombre) {
            return res.status(400).json({ error: 'El nombre es requerido' });
        }

        const tipoPresentacionValidado = await validarTipoPresentacionParaPresentacion(tipoPresentacionId);
        if (!tipoPresentacionValidado.ok) {
            return res.status(400).json({ error: tipoPresentacionValidado.error });
        }

        const now = new Date().toISOString();
        const result = await database.run(`
            INSERT INTO presentaciones (nombre, tipo, cantidad, tipo_presentacion_id, activo, creado_en, actualizado_en)
            VALUES (?, ?, ?, ?, 1, ?, ?)
        `, [nombre, tipo, cantidad, tipoPresentacionId, now, now]);

        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            ['crear_presentacion', req.session.userId, `Presentación ${nombre} creada`, now]
        );

        res.json({
            success: true,
            data: { id: result.id, nombre, tipo, cantidad, tipo_presentacion_id: tipoPresentacionId, tipo_presentacion_nombre: tipoPresentacionValidado.tipo.nombre, activo: 1 }
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
        const tipoPresentacionId = req.body.tipo_presentacion_id !== undefined
            ? parseNumber(req.body.tipo_presentacion_id, null)
            : (presentacion.tipo_presentacion_id || null);
        const tipo = req.body.tipo !== undefined ? (req.body.tipo || 'tamaño') : (presentacion.tipo || 'tamaño');
        const cantidad = req.body.cantidad !== undefined ? (req.body.cantidad || null) : presentacion.cantidad;
        const activo = req.body.activo !== undefined ? (parseBoolean(req.body.activo) ? 1 : 0) : (isActive(presentacion.activo) ? 1 : 0);

        if (!nombre) {
            return res.status(400).json({ error: 'El nombre es requerido' });
        }

        const tipoPresentacionValidado = await validarTipoPresentacionParaPresentacion(tipoPresentacionId);
        if (!tipoPresentacionValidado.ok) {
            return res.status(400).json({ error: tipoPresentacionValidado.error });
        }

        await database.run(`
            UPDATE presentaciones
            SET nombre = ?, tipo = ?, cantidad = ?, tipo_presentacion_id = ?, activo = ?, actualizado_en = ?
            WHERE id = ?
        `, [nombre, tipo, cantidad, tipoPresentacionId, activo, new Date().toISOString(), id]);

        await database.run(
            'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
            ['actualizar_presentacion', req.session.userId, `Presentación ${nombre} actualizada (${activo ? 'activa' : 'inactiva'})`, new Date().toISOString()]
        );

        res.json({ success: true, data: { id: Number(id), nombre, tipo, cantidad, tipo_presentacion_id: tipoPresentacionId, tipo_presentacion_nombre: tipoPresentacionValidado.tipo.nombre, activo } });
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

const MENU_TEMPLATE_VERSION = 'v2.2.5M.11';
const MENU_TEMPLATE_ID = 'MUNDIPOS_MENU_TEMPLATE';
const MENU_TEMPLATE_SCHEMA = 'menu-template-v1';

function templateText(value, fallback = '') {
    if (value === undefined || value === null) return fallback;
    return String(value).trim();
}

function templateBool(value, fallback = 'SI') {
    if (value === undefined || value === null || value === '') return fallback;
    if (value === true || value === 1 || value === '1') return 'SI';
    const normalized = String(value).trim().toLowerCase();
    return ['si', 'sí', 's', 'yes', 'y', 'true', 'activo', 'on'].includes(normalized) ? 'SI' : 'NO';
}

function templateNumber(value, fallback = '') {
    if (value === undefined || value === null || value === '') return fallback;
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function normalizeTemplateArray(value) {
    return Array.isArray(value) ? value : [];
}

function normalizeTemplatePreparationDestination(row = {}) {
    const legacyKitchen = templateBool(row.es_cocina, 'NO') === 'SI';
    return normalizePreparationDestination(row.destino_preparacion, legacyKitchen);
}

function normalizeMenuTemplateDraft(payload = {}) {
    const draft = payload.draft || payload || {};

    return {
        metadata: {
            negocio: templateText(draft.metadata?.negocio || draft.negocio || 'MundiPOS'),
            moneda: templateText(draft.metadata?.moneda || draft.moneda || 'CRC'),
            creado_por: templateText(draft.metadata?.creado_por || draft.creado_por || 'Administrador'),
            notas: templateText(draft.metadata?.notas || draft.notas || '')
        },
        categories: normalizeTemplateArray(draft.categories || draft.categorias).map((row, index) => ({
            clave_categoria: templateText(row.clave_categoria || row.clave || `CAT-${index + 1}`),
            nombre: templateText(row.nombre),
            permite_cocina: templateBool(row.permite_cocina),
            activa: templateBool(row.activa)
        })),
        subcategories: normalizeTemplateArray(draft.subcategories || draft.subcategorias).map((row, index) => ({
            clave_categoria: templateText(row.clave_categoria),
            clave_subcategoria: templateText(row.clave_subcategoria || row.clave || `SUB-${index + 1}`),
            nombre: templateText(row.nombre),
            permite_cocina: templateBool(row.permite_cocina),
            activa: templateBool(row.activa)
        })),
        presentationTypes: normalizeTemplateArray(draft.presentationTypes || draft.tipos_presentacion).map((row, index) => ({
            clave_tipo: templateText(row.clave_tipo || row.clave || `TIP-${index + 1}`),
            nombre: templateText(row.nombre),
            clave_categoria: templateText(row.clave_categoria),
            clave_subcategoria: templateText(row.clave_subcategoria),
            descripcion: templateText(row.descripcion),
            activo: templateBool(row.activo)
        })),
        presentations: normalizeTemplateArray(draft.presentations || draft.presentaciones).map((row, index) => ({
            clave_presentacion: templateText(row.clave_presentacion || row.clave || `PRE-${index + 1}`),
            nombre: templateText(row.nombre),
            tipo: templateText(row.tipo || 'Tamaño'),
            cantidad: templateText(row.cantidad),
            clave_tipo: templateText(row.clave_tipo),
            activo: templateBool(row.activo)
        })),
        products: normalizeTemplateArray(draft.products || draft.productos).map((row, index) => {
            const destination = normalizeTemplatePreparationDestination(row);
            return {
                clave_producto: templateText(row.clave_producto || row.clave || `PROD-${index + 1}`),
                nombre: templateText(row.nombre),
                descripcion: templateText(row.descripcion),
                clave_categoria: templateText(row.clave_categoria),
                clave_subcategoria: templateText(row.clave_subcategoria),
                precio_base: templateNumber(row.precio_base),
                tiene_presentaciones: templateBool(row.tiene_presentaciones, 'NO'),
                clave_tipo: templateText(row.clave_tipo),
                destino_preparacion: destination,
                es_cocina: destination === 'ninguno' ? 'NO' : 'SI',
                activo: templateBool(row.activo)
            };
        }),
        productPresentations: normalizeTemplateArray(draft.productPresentations || draft.producto_presentaciones).map((row) => ({
            clave_producto: templateText(row.clave_producto),
            clave_presentacion: templateText(row.clave_presentacion),
            precio: templateNumber(row.precio),
            activo: templateBool(row.activo)
        }))
    };
}

function validateMenuTemplateDraft(draft) {
    const errors = [];
    const warnings = [];
    const keys = {
        categories: new Set(),
        subcategories: new Set(),
        presentationTypes: new Set(),
        presentations: new Set(),
        products: new Set()
    };

    function requireValue(value, message) {
        if (!templateText(value)) errors.push(message);
    }

    function unique(set, value, message) {
        const normalized = templateText(value).toLowerCase();
        if (!normalized) return;
        if (set.has(normalized)) errors.push(message);
        set.add(normalized);
    }

    if (draft.categories.length === 0) {
        warnings.push('La plantilla no contiene categorías. Se generará estructura vacía para completar en Excel.');
    }

    draft.categories.forEach((row, index) => {
        requireValue(row.clave_categoria, `Categorías fila ${index + 1}: clave_categoria requerida.`);
        requireValue(row.nombre, `Categorías fila ${index + 1}: nombre requerido.`);
        unique(keys.categories, row.clave_categoria, `Categorías fila ${index + 1}: clave_categoria duplicada.`);
    });

    draft.subcategories.forEach((row, index) => {
        requireValue(row.clave_categoria, `Subcategorías fila ${index + 1}: clave_categoria requerida.`);
        requireValue(row.clave_subcategoria, `Subcategorías fila ${index + 1}: clave_subcategoria requerida.`);
        requireValue(row.nombre, `Subcategorías fila ${index + 1}: nombre requerido.`);
        unique(keys.subcategories, row.clave_subcategoria, `Subcategorías fila ${index + 1}: clave_subcategoria duplicada.`);
        if (row.clave_categoria && !keys.categories.has(row.clave_categoria.toLowerCase())) {
            warnings.push(`Subcategorías fila ${index + 1}: la categoría ${row.clave_categoria} no existe todavía en la hoja 01_Categorias.`);
        }
    });

    draft.presentationTypes.forEach((row, index) => {
        requireValue(row.clave_tipo, `Tipos fila ${index + 1}: clave_tipo requerida.`);
        requireValue(row.nombre, `Tipos fila ${index + 1}: nombre requerido.`);
        requireValue(row.clave_categoria, `Tipos fila ${index + 1}: clave_categoria requerida.`);
        unique(keys.presentationTypes, row.clave_tipo, `Tipos fila ${index + 1}: clave_tipo duplicada.`);
    });

    draft.presentations.forEach((row, index) => {
        requireValue(row.clave_presentacion, `Presentaciones fila ${index + 1}: clave_presentacion requerida.`);
        requireValue(row.nombre, `Presentaciones fila ${index + 1}: nombre requerido.`);
        requireValue(row.clave_tipo, `Presentaciones fila ${index + 1}: clave_tipo requerida.`);
        unique(keys.presentations, row.clave_presentacion, `Presentaciones fila ${index + 1}: clave_presentacion duplicada.`);
        if (row.clave_tipo && !keys.presentationTypes.has(row.clave_tipo.toLowerCase())) {
            warnings.push(`Presentaciones fila ${index + 1}: el tipo/grupo ${row.clave_tipo} no existe todavía en la hoja 03_TiposPresentacion.`);
        }
    });

    draft.products.forEach((row, index) => {
        requireValue(row.clave_producto, `Productos fila ${index + 1}: clave_producto requerida.`);
        requireValue(row.nombre, `Productos fila ${index + 1}: nombre requerido.`);
        requireValue(row.clave_categoria, `Productos fila ${index + 1}: clave_categoria requerida.`);
        unique(keys.products, row.clave_producto, `Productos fila ${index + 1}: clave_producto duplicada.`);

        if (row.tiene_presentaciones === 'SI' && !row.clave_tipo) {
            errors.push(`Productos fila ${index + 1}: si tiene presentaciones debe indicar clave_tipo.`);
        }

        if (row.tiene_presentaciones !== 'SI' && Number(row.precio_base) <= 0) {
            warnings.push(`Productos fila ${index + 1}: producto sin presentaciones debería tener precio_base mayor a cero.`);
        }
    });

    draft.productPresentations.forEach((row, index) => {
        requireValue(row.clave_producto, `ProductoPresentaciones fila ${index + 1}: clave_producto requerida.`);
        requireValue(row.clave_presentacion, `ProductoPresentaciones fila ${index + 1}: clave_presentacion requerida.`);
        if (Number(row.precio) <= 0) errors.push(`ProductoPresentaciones fila ${index + 1}: precio debe ser mayor a cero.`);
        if (row.clave_producto && !keys.products.has(row.clave_producto.toLowerCase())) {
            warnings.push(`ProductoPresentaciones fila ${index + 1}: el producto ${row.clave_producto} no existe todavía en la hoja 05_Productos.`);
        }
        if (row.clave_presentacion && !keys.presentations.has(row.clave_presentacion.toLowerCase())) {
            warnings.push(`ProductoPresentaciones fila ${index + 1}: la presentación ${row.clave_presentacion} no existe todavía en la hoja 04_Presentaciones.`);
        }
    });

    return { errors, warnings };
}

function xmlEscape(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function columnName(index) {
    let name = '';
    let value = index + 1;
    while (value > 0) {
        const modulo = (value - 1) % 26;
        name = String.fromCharCode(65 + modulo) + name;
        value = Math.floor((value - modulo) / 26);
    }
    return name;
}

function worksheetXml(rows, widths = []) {
    const cols = widths.length
        ? `<cols>${widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('')}</cols>`
        : '';

    const sheetData = rows.map((row, rowIndex) => {
        const cells = row.map((cell, colIndex) => {
            const ref = `${columnName(colIndex)}${rowIndex + 1}`;
            const value = typeof cell === 'object' && cell !== null ? cell.value : cell;
            const style = typeof cell === 'object' && cell !== null ? Number(cell.style || 0) : (rowIndex === 0 ? 1 : 0);
            const type = typeof cell === 'object' && cell !== null ? cell.type : (typeof value === 'number' ? 'n' : 's');

            if (type === 'n' && value !== '') {
                return `<c r="${ref}" s="${style || 2}"><v>${Number(value)}</v></c>`;
            }
            return `<c r="${ref}" t="inlineStr" s="${style}"><is><t>${xmlEscape(value)}</t></is></c>`;
        }).join('');

        return `<row r="${rowIndex + 1}">${cells}</row>`;
    }).join('');

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
${cols}<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>${sheetData}</sheetData></worksheet>`;
}

function workbookXml(sheets) {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, index) => `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets></workbook>`;
}

function workbookRelsXml(sheets) {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((sheet, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
}

function stylesXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FF172033"/><sz val="12"/><name val="Calibri"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF172033"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAF3FB"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFD9E2EC"/></left><right style="thin"><color rgb="FFD9E2EC"/></right><top style="thin"><color rgb="FFD9E2EC"/></top><bottom style="thin"><color rgb="FFD9E2EC"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFill="1" applyFont="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFill="1" applyFont="1"/></cellXfs></styleSheet>`;
}

function contentTypesXml(sheets) {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((sheet, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`;
}

function rootRelsXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
}

const crcTable = (() => {
    const table = new Array(256);
    for (let i = 0; i < 256; i += 1) {
        let c = i;
        for (let k = 0; k < 8; k += 1) {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[i] = c >>> 0;
    }
    return table;
})();

function crc32(buffer) {
    let crc = 0 ^ -1;
    for (let i = 0; i < buffer.length; i += 1) {
        crc = (crc >>> 8) ^ crcTable[(crc ^ buffer[i]) & 0xFF];
    }
    return (crc ^ -1) >>> 0;
}

function dosTimeDate(date = new Date()) {
    const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
    const year = Math.max(date.getFullYear(), 1980);
    const day = (year - 1980) << 9 | ((date.getMonth() + 1) << 5) | date.getDate();
    return { time, day };
}

function createZip(files) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    const now = dosTimeDate();

    files.forEach(file => {
        const nameBuffer = Buffer.from(file.name, 'utf8');
        const dataBuffer = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data, 'utf8');
        const crc = crc32(dataBuffer);

        const localHeader = Buffer.alloc(30);
        localHeader.writeUInt32LE(0x04034b50, 0);
        localHeader.writeUInt16LE(20, 4);
        localHeader.writeUInt16LE(0x0800, 6);
        localHeader.writeUInt16LE(0, 8);
        localHeader.writeUInt16LE(now.time, 10);
        localHeader.writeUInt16LE(now.day, 12);
        localHeader.writeUInt32LE(crc, 14);
        localHeader.writeUInt32LE(dataBuffer.length, 18);
        localHeader.writeUInt32LE(dataBuffer.length, 22);
        localHeader.writeUInt16LE(nameBuffer.length, 26);
        localHeader.writeUInt16LE(0, 28);

        localParts.push(localHeader, nameBuffer, dataBuffer);

        const centralHeader = Buffer.alloc(46);
        centralHeader.writeUInt32LE(0x02014b50, 0);
        centralHeader.writeUInt16LE(20, 4);
        centralHeader.writeUInt16LE(20, 6);
        centralHeader.writeUInt16LE(0x0800, 8);
        centralHeader.writeUInt16LE(0, 10);
        centralHeader.writeUInt16LE(now.time, 12);
        centralHeader.writeUInt16LE(now.day, 14);
        centralHeader.writeUInt32LE(crc, 16);
        centralHeader.writeUInt32LE(dataBuffer.length, 20);
        centralHeader.writeUInt32LE(dataBuffer.length, 24);
        centralHeader.writeUInt16LE(nameBuffer.length, 28);
        centralHeader.writeUInt16LE(0, 30);
        centralHeader.writeUInt16LE(0, 32);
        centralHeader.writeUInt16LE(0, 34);
        centralHeader.writeUInt16LE(0, 36);
        centralHeader.writeUInt32LE(0, 38);
        centralHeader.writeUInt32LE(offset, 42);
        centralParts.push(centralHeader, nameBuffer);

        offset += localHeader.length + nameBuffer.length + dataBuffer.length;
    });

    const centralOffset = offset;
    const centralBuffer = Buffer.concat(centralParts);
    const endHeader = Buffer.alloc(22);
    endHeader.writeUInt32LE(0x06054b50, 0);
    endHeader.writeUInt16LE(0, 4);
    endHeader.writeUInt16LE(0, 6);
    endHeader.writeUInt16LE(files.length, 8);
    endHeader.writeUInt16LE(files.length, 10);
    endHeader.writeUInt32LE(centralBuffer.length, 12);
    endHeader.writeUInt32LE(centralOffset, 16);
    endHeader.writeUInt16LE(0, 20);

    return Buffer.concat([...localParts, centralBuffer, endHeader]);
}

function buildMenuTemplateWorkbook(draft, validation) {
    const generatedAt = new Date().toISOString();
    const sheets = [
        {
            name: '_METADATA',
            widths: [28, 48],
            rows: [
                ['campo', 'valor'],
                ['template_id', MENU_TEMPLATE_ID],
                ['app', 'MundiPOS'],
                ['module', 'menu_import'],
                ['template_version', MENU_TEMPLATE_VERSION],
                ['schema', MENU_TEMPLATE_SCHEMA],
                ['generated_at', generatedAt],
                ['negocio', draft.metadata.negocio],
                ['moneda', draft.metadata.moneda],
                ['creado_por', draft.metadata.creado_por],
                ['notas', draft.metadata.notas]
            ]
        },
        {
            name: 'README',
            widths: [34, 96],
            rows: [
                ['seccion', 'descripcion'],
                ['Orden de creación', '1) Categorías. 2) Subcategorías. 3) Tipos/Grupos de presentación. 4) Presentaciones. 5) Productos. 6) ProductoPresentaciones.'],
                ['Regla principal', 'No cambie los nombres de hojas ni columnas. La importación M.12 aceptará solo esta estructura oficial.'],
                ['Claves', 'Use claves simples y únicas, por ejemplo CAT-BEBIDAS, SUB-GASEOSAS, TIP-GASEOSAS, PRE-350ML, PROD-COCACOLA.'],
                ['Productos con presentación', 'Use tiene_presentaciones=SI, indique clave_tipo y cargue precios en 06_ProductoPresentaciones.'],
                ['Productos sin presentación', 'Use tiene_presentaciones=NO y complete precio_base en 05_Productos.'],
                ['Preparación', 'Use destino_preparacion=ninguno, cocina o bar. La columna es_cocina se conserva para plantillas anteriores.'],
                ['Validación generador', `${validation.errors.length} errores · ${validation.warnings.length} advertencias al generar.`]
            ]
        },
        {
            name: '01_Categorias',
            widths: [24, 28, 18, 14],
            rows: [['clave_categoria', 'nombre', 'permite_cocina', 'activa'], ...draft.categories.map(row => [row.clave_categoria, row.nombre, row.permite_cocina, row.activa])]
        },
        {
            name: '02_Subcategorias',
            widths: [24, 24, 28, 18, 14],
            rows: [['clave_categoria', 'clave_subcategoria', 'nombre', 'permite_cocina', 'activa'], ...draft.subcategories.map(row => [row.clave_categoria, row.clave_subcategoria, row.nombre, row.permite_cocina, row.activa])]
        },
        {
            name: '03_TiposPresentacion',
            widths: [24, 28, 24, 24, 46, 14],
            rows: [['clave_tipo', 'nombre', 'clave_categoria', 'clave_subcategoria', 'descripcion', 'activo'], ...draft.presentationTypes.map(row => [row.clave_tipo, row.nombre, row.clave_categoria, row.clave_subcategoria, row.descripcion, row.activo])]
        },
        {
            name: '04_Presentaciones',
            widths: [24, 28, 20, 20, 24, 14],
            rows: [['clave_presentacion', 'nombre', 'tipo', 'cantidad', 'clave_tipo', 'activo'], ...draft.presentations.map(row => [row.clave_presentacion, row.nombre, row.tipo, row.cantidad, row.clave_tipo, row.activo])]
        },
        {
            name: '05_Productos',
            widths: [24, 30, 42, 24, 24, 16, 22, 24, 22, 16, 14],
            rows: [['clave_producto', 'nombre', 'descripcion', 'clave_categoria', 'clave_subcategoria', 'precio_base', 'tiene_presentaciones', 'clave_tipo', 'destino_preparacion', 'es_cocina', 'activo'], ...draft.products.map(row => [row.clave_producto, row.nombre, row.descripcion, row.clave_categoria, row.clave_subcategoria, { value: row.precio_base, type: typeof row.precio_base === 'number' ? 'n' : 's' }, row.tiene_presentaciones, row.clave_tipo, row.destino_preparacion, row.es_cocina, row.activo])]
        },
        {
            name: '06_ProductoPresentaciones',
            widths: [24, 26, 16, 14],
            rows: [['clave_producto', 'clave_presentacion', 'precio', 'activo'], ...draft.productPresentations.map(row => [row.clave_producto, row.clave_presentacion, { value: row.precio, type: typeof row.precio === 'number' ? 'n' : 's' }, row.activo])]
        },
        {
            name: '07_Validacion',
            widths: [18, 110],
            rows: [
                ['tipo', 'mensaje'],
                ...validation.errors.map(message => ['ERROR', message]),
                ...validation.warnings.map(message => ['ADVERTENCIA', message]),
                ...(validation.errors.length === 0 && validation.warnings.length === 0 ? [['OK', 'Sin observaciones del generador asistido.']] : [])
            ]
        }
    ];

    const files = [
        { name: '[Content_Types].xml', data: contentTypesXml(sheets) },
        { name: '_rels/.rels', data: rootRelsXml() },
        { name: 'xl/workbook.xml', data: workbookXml(sheets) },
        { name: 'xl/_rels/workbook.xml.rels', data: workbookRelsXml(sheets) },
        { name: 'xl/styles.xml', data: stylesXml() },
        ...sheets.map((sheet, index) => ({ name: `xl/worksheets/sheet${index + 1}.xml`, data: worksheetXml(sheet.rows, sheet.widths) }))
    ];

    return createZip(files);
}

function decodeXmlEntities(value = '') {
    return String(value)
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
}

function columnNameToIndex(cellRef = '') {
    const letters = String(cellRef).replace(/[0-9]/g, '').toUpperCase();
    let index = 0;
    for (const char of letters) {
        index = index * 26 + (char.charCodeAt(0) - 64);
    }
    return Math.max(index - 1, 0);
}

function readZipEntries(buffer) {
    const entries = new Map();
    let eocdOffset = -1;

    for (let index = buffer.length - 22; index >= 0; index -= 1) {
        if (buffer.readUInt32LE(index) === 0x06054b50) {
            eocdOffset = index;
            break;
        }
    }

    if (eocdOffset < 0) {
        throw new Error('No se encontró el directorio central del archivo XLSX.');
    }

    const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
    const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
    let offset = centralDirectoryOffset;

    for (let entryIndex = 0; entryIndex < totalEntries; entryIndex += 1) {
        if (buffer.readUInt32LE(offset) !== 0x02014b50) {
            throw new Error('Directorio central XLSX inválido.');
        }

        const method = buffer.readUInt16LE(offset + 10);
        const compressedSize = buffer.readUInt32LE(offset + 20);
        const fileNameLength = buffer.readUInt16LE(offset + 28);
        const extraLength = buffer.readUInt16LE(offset + 30);
        const commentLength = buffer.readUInt16LE(offset + 32);
        const localHeaderOffset = buffer.readUInt32LE(offset + 42);
        const name = buffer.slice(offset + 46, offset + 46 + fileNameLength).toString('utf8').replace(/^\//, '');

        if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
            throw new Error(`Encabezado local inválido para ${name}.`);
        }

        const localFileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
        const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
        const dataStart = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
        const compressedData = buffer.slice(dataStart, dataStart + compressedSize);
        let data;

        if (method === 0) {
            data = compressedData;
        } else if (method === 8) {
            data = zlib.inflateRawSync(compressedData);
        } else {
            throw new Error(`Método de compresión ZIP no soportado: ${method}`);
        }

        entries.set(name, data);
        offset += 46 + fileNameLength + extraLength + commentLength;
    }

    return entries;
}

function parseSharedStrings(xml = '') {
    const values = [];
    const siRegex = /<si[\s\S]*?<\/si>/g;
    const matches = xml.match(siRegex) || [];

    matches.forEach(si => {
        const pieces = [];
        const textRegex = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
        let textMatch;
        while ((textMatch = textRegex.exec(si))) {
            pieces.push(decodeXmlEntities(textMatch[1] || ''));
        }
        values.push(pieces.join(''));
    });

    return values;
}

function parseWorkbookSheets(entries) {
    const workbookXmlBuffer = entries.get('xl/workbook.xml');
    if (!workbookXmlBuffer) throw new Error('El archivo no contiene xl/workbook.xml');

    const workbookXml = workbookXmlBuffer.toString('utf8');
    const relsXml = (entries.get('xl/_rels/workbook.xml.rels') || Buffer.from('')).toString('utf8');
    const rels = {};
    const relRegex = /<Relationship\s+([^>]+?)\/>/g;
    let relMatch;
    while ((relMatch = relRegex.exec(relsXml))) {
        const attrs = relMatch[1];
        const id = (attrs.match(/Id="([^"]+)"/) || [])[1];
        const target = (attrs.match(/Target="([^"]+)"/) || [])[1];
        if (id && target) rels[id] = target.startsWith('/') ? target.slice(1) : `xl/${target}`.replace(/\/\.\//g, '/');
    }

    const sheets = {};
    const sheetRegex = /<sheet\s+([^>]+?)\/>/g;
    let sheetMatch;
    while ((sheetMatch = sheetRegex.exec(workbookXml))) {
        const attrs = sheetMatch[1];
        const name = decodeXmlEntities((attrs.match(/name="([^"]+)"/) || [])[1] || '');
        const rid = (attrs.match(/r:id="([^"]+)"/) || [])[1];
        const target = rels[rid];
        if (name && target && entries.has(target)) {
            sheets[name] = entries.get(target).toString('utf8');
        }
    }

    return sheets;
}

function parseWorksheetRows(xml = '', sharedStrings = []) {
    const rows = [];
    const rowRegex = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
    let rowMatch;

    while ((rowMatch = rowRegex.exec(xml))) {
        const rowCells = [];
        const rowContent = rowMatch[1];
        const cellRegex = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
        let cellMatch;

        while ((cellMatch = cellRegex.exec(rowContent))) {
            const attrs = cellMatch[1] || '';
            const content = cellMatch[2] || '';
            const ref = (attrs.match(/r="([A-Z]+[0-9]+)"/) || [])[1] || '';
            const type = (attrs.match(/t="([^"]+)"/) || [])[1] || '';
            const colIndex = columnNameToIndex(ref || `A${rows.length + 1}`);
            let value = '';

            if (type === 'inlineStr') {
                const texts = [];
                const textRegex = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
                let textMatch;
                while ((textMatch = textRegex.exec(content))) texts.push(decodeXmlEntities(textMatch[1] || ''));
                value = texts.join('');
            } else {
                const v = (content.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
                if (v !== undefined) {
                    value = type === 's' ? (sharedStrings[Number(v)] || '') : decodeXmlEntities(v);
                }
            }

            rowCells[colIndex] = String(value ?? '').trim();
        }

        rows.push(rowCells.map(value => value ?? ''));
    }

    return rows;
}

function rowsToObjects(rows, requiredHeaders, sheetName, errors) {
    if (!rows.length) {
        errors.push(`${sheetName}: hoja vacía.`);
        return [];
    }

    const headers = (rows[0] || []).map(value => String(value || '').trim());
    const normalizedHeaders = headers.map(header => header.toLowerCase());

    requiredHeaders.forEach(header => {
        if (!normalizedHeaders.includes(header.toLowerCase())) {
            errors.push(`${sheetName}: falta la columna requerida ${header}.`);
        }
    });

    return rows.slice(1)
        .filter(row => (row || []).some(cell => String(cell || '').trim()))
        .map(row => {
            const object = {};
            headers.forEach((header, index) => {
                if (header) object[header] = row[index] ?? '';
            });
            return object;
        });
}

function parseMenuTemplateWorkbook(fileBase64 = '') {
    const cleanBase64 = String(fileBase64 || '').replace(/^data:.*?;base64,/, '');
    if (!cleanBase64) throw new Error('Archivo de plantilla requerido.');

    const buffer = Buffer.from(cleanBase64, 'base64');
    if (buffer.length < 4 || buffer.readUInt32LE(0) !== 0x04034b50) {
        throw new Error('El archivo no parece ser un .xlsx válido.');
    }

    const entries = readZipEntries(buffer);
    const sharedStrings = entries.has('xl/sharedStrings.xml')
        ? parseSharedStrings(entries.get('xl/sharedStrings.xml').toString('utf8'))
        : [];
    const sheets = parseWorkbookSheets(entries);
    const errors = [];

    const requiredSheets = {
        '_METADATA': ['campo', 'valor'],
        '01_Categorias': ['clave_categoria', 'nombre', 'permite_cocina', 'activa'],
        '02_Subcategorias': ['clave_categoria', 'clave_subcategoria', 'nombre', 'permite_cocina', 'activa'],
        '03_TiposPresentacion': ['clave_tipo', 'nombre', 'clave_categoria', 'clave_subcategoria', 'descripcion', 'activo'],
        '04_Presentaciones': ['clave_presentacion', 'nombre', 'tipo', 'cantidad', 'clave_tipo', 'activo'],
        '05_Productos': ['clave_producto', 'nombre', 'descripcion', 'clave_categoria', 'clave_subcategoria', 'precio_base', 'tiene_presentaciones', 'clave_tipo', 'es_cocina', 'activo'],
        '06_ProductoPresentaciones': ['clave_producto', 'clave_presentacion', 'precio', 'activo']
    };

    Object.keys(requiredSheets).forEach(sheetName => {
        if (!sheets[sheetName]) errors.push(`Falta la hoja requerida ${sheetName}.`);
    });

    const parsedRows = {};
    Object.entries(requiredSheets).forEach(([sheetName, headers]) => {
        if (!sheets[sheetName]) {
            parsedRows[sheetName] = [];
            return;
        }
        parsedRows[sheetName] = rowsToObjects(parseWorksheetRows(sheets[sheetName], sharedStrings), headers, sheetName, errors);
    });

    const metadata = {};
    parsedRows._METADATA.forEach(row => {
        const key = templateText(row.campo).toLowerCase();
        if (key) metadata[key] = templateText(row.valor);
    });

    if (metadata.template_id !== MENU_TEMPLATE_ID) {
        errors.push('La plantilla no corresponde a MundiPOS o no contiene template_id válido.');
    }

    if (metadata.schema !== MENU_TEMPLATE_SCHEMA) {
        errors.push(`La plantilla usa un schema no compatible. Esperado: ${MENU_TEMPLATE_SCHEMA}.`);
    }

    const draft = normalizeMenuTemplateDraft({
        metadata: {
            negocio: metadata.negocio || 'MundiPOS',
            moneda: metadata.moneda || 'CRC',
            creado_por: metadata.creado_por || 'Administrador',
            notas: metadata.notas || ''
        },
        categories: parsedRows['01_Categorias'],
        subcategories: parsedRows['02_Subcategorias'],
        presentationTypes: parsedRows['03_TiposPresentacion'],
        presentations: parsedRows['04_Presentaciones'],
        products: parsedRows['05_Productos'],
        productPresentations: parsedRows['06_ProductoPresentaciones']
    });

    return { draft, metadata, structureErrors: errors };
}

function templateYesNoToBool(value, fallback = true) {
    const normalized = templateText(value).toLowerCase();
    if (!normalized) return fallback ? 1 : 0;
    return ['si', 'sí', 's', 'yes', 'y', 'true', '1', 'activo', 'on'].includes(normalized) ? 1 : 0;
}

function normalizeLookupKey(value) {
    return templateText(value).toLowerCase();
}

async function findCategoryByName(nombre, parentId = null) {
    if (parentId) {
        return database.get('SELECT * FROM categorias WHERE LOWER(nombre) = LOWER(?) AND parent_id = ?', [nombre, parentId]);
    }
    return database.get('SELECT * FROM categorias WHERE LOWER(nombre) = LOWER(?) AND parent_id IS NULL', [nombre]);
}

async function findPresentationTypeByContext(nombre, categoriaId, subcategoriaId) {
    return database.get(`
        SELECT * FROM tipos_presentacion
        WHERE LOWER(nombre) = LOWER(?)
          AND categoria_id = ?
          AND COALESCE(subcategoria_id, 0) = COALESCE(?, 0)
    `, [nombre, categoriaId, subcategoriaId || null]);
}

async function findPresentationByContext(nombre, tipoPresentacionId) {
    return database.get(`
        SELECT * FROM presentaciones
        WHERE LOWER(nombre) = LOWER(?)
          AND COALESCE(tipo_presentacion_id, 0) = COALESCE(?, 0)
    `, [nombre, tipoPresentacionId || null]);
}

async function findProductByName(nombre) {
    return database.get('SELECT * FROM productos WHERE LOWER(nombre) = LOWER(?) LIMIT 1', [nombre]);
}

function validateTemplateImportRelations(draft) {
    const errors = [];
    const categoryByKey = new Map(draft.categories.map(row => [normalizeLookupKey(row.clave_categoria), row]));
    const subcategoryByKey = new Map(draft.subcategories.map(row => [normalizeLookupKey(row.clave_subcategoria), row]));
    const typeByKey = new Map(draft.presentationTypes.map(row => [normalizeLookupKey(row.clave_tipo), row]));
    const presentationByKey = new Map(draft.presentations.map(row => [normalizeLookupKey(row.clave_presentacion), row]));
    const productByKey = new Map(draft.products.map(row => [normalizeLookupKey(row.clave_producto), row]));
    const productPresentationKeys = new Set(draft.productPresentations.map(row => normalizeLookupKey(row.clave_producto)).filter(Boolean));

    draft.subcategories.forEach((row, index) => {
        if (row.clave_categoria && !categoryByKey.has(normalizeLookupKey(row.clave_categoria))) {
            errors.push(`Subcategorías fila ${index + 1}: la categoría ${row.clave_categoria} no existe.`);
        }
    });

    draft.presentationTypes.forEach((row, index) => {
        if (row.clave_categoria && !categoryByKey.has(normalizeLookupKey(row.clave_categoria))) {
            errors.push(`Tipos fila ${index + 1}: la categoría ${row.clave_categoria} no existe.`);
        }
        if (row.clave_subcategoria) {
            const sub = subcategoryByKey.get(normalizeLookupKey(row.clave_subcategoria));
            if (!sub) {
                errors.push(`Tipos fila ${index + 1}: la subcategoría ${row.clave_subcategoria} no existe.`);
            } else if (normalizeLookupKey(sub.clave_categoria) !== normalizeLookupKey(row.clave_categoria)) {
                errors.push(`Tipos fila ${index + 1}: la subcategoría ${row.clave_subcategoria} no pertenece a ${row.clave_categoria}.`);
            }
        }
    });

    draft.presentations.forEach((row, index) => {
        if (row.clave_tipo && !typeByKey.has(normalizeLookupKey(row.clave_tipo))) {
            errors.push(`Presentaciones fila ${index + 1}: el tipo/grupo ${row.clave_tipo} no existe.`);
        }
    });

    draft.products.forEach((row, index) => {
        if (row.clave_categoria && !categoryByKey.has(normalizeLookupKey(row.clave_categoria))) {
            errors.push(`Productos fila ${index + 1}: la categoría ${row.clave_categoria} no existe.`);
        }
        if (row.clave_subcategoria) {
            const sub = subcategoryByKey.get(normalizeLookupKey(row.clave_subcategoria));
            if (!sub) {
                errors.push(`Productos fila ${index + 1}: la subcategoría ${row.clave_subcategoria} no existe.`);
            } else if (normalizeLookupKey(sub.clave_categoria) !== normalizeLookupKey(row.clave_categoria)) {
                errors.push(`Productos fila ${index + 1}: la subcategoría ${row.clave_subcategoria} no pertenece a ${row.clave_categoria}.`);
            }
        }
        if (row.destino_preparacion === 'cocina') {
            const category = categoryByKey.get(normalizeLookupKey(row.clave_categoria));
            const subcategory = row.clave_subcategoria
                ? subcategoryByKey.get(normalizeLookupKey(row.clave_subcategoria))
                : null;
            const categoryAllowsKitchen = category?.permite_cocina === 'SI';
            const subcategoryAllowsKitchen = subcategory?.permite_cocina === 'SI';
            if ((!subcategory && !categoryAllowsKitchen)
                || (subcategory && !categoryAllowsKitchen && !subcategoryAllowsKitchen)) {
                errors.push(`Productos fila ${index + 1}: la categoría o subcategoría no permite destino cocina.`);
            }
        }
        if (row.tiene_presentaciones === 'SI') {
            const type = typeByKey.get(normalizeLookupKey(row.clave_tipo));
            if (!type) {
                errors.push(`Productos fila ${index + 1}: el tipo/grupo ${row.clave_tipo} no existe.`);
            } else if (normalizeLookupKey(type.clave_categoria) !== normalizeLookupKey(row.clave_categoria)) {
                errors.push(`Productos fila ${index + 1}: el tipo/grupo ${row.clave_tipo} no pertenece a ${row.clave_categoria}.`);
            }
            if (!productPresentationKeys.has(normalizeLookupKey(row.clave_producto))) {
                errors.push(`Productos fila ${index + 1}: producto con presentación sin precios en 06_ProductoPresentaciones.`);
            }
        }
    });

    draft.productPresentations.forEach((row, index) => {
        const product = productByKey.get(normalizeLookupKey(row.clave_producto));
        const presentation = presentationByKey.get(normalizeLookupKey(row.clave_presentacion));
        if (!product) {
            errors.push(`ProductoPresentaciones fila ${index + 1}: producto ${row.clave_producto} no existe.`);
        }
        if (!presentation) {
            errors.push(`ProductoPresentaciones fila ${index + 1}: presentación ${row.clave_presentacion} no existe.`);
        }
        if (product && presentation && product.clave_tipo && presentation.clave_tipo && normalizeLookupKey(product.clave_tipo) !== normalizeLookupKey(presentation.clave_tipo)) {
            errors.push(`ProductoPresentaciones fila ${index + 1}: la presentación ${row.clave_presentacion} no pertenece al tipo/grupo del producto ${row.clave_producto}.`);
        }
    });

    return errors;
}

function buildTemplateImportSummary(draft, validation, structureErrors = []) {
    const relationErrors = validateTemplateImportRelations(draft);
    const errors = [...structureErrors, ...validation.errors, ...relationErrors];
    const warnings = [...validation.warnings];
    const productsWithPresentations = draft.products.filter(row => row.tiene_presentaciones === 'SI').length;
    const productsWithoutPresentations = draft.products.length - productsWithPresentations;

    return {
        can_import: errors.length === 0,
        errors,
        warnings,
        summary: {
            categorias: draft.categories.length,
            subcategorias: draft.subcategories.length,
            tipos_presentacion: draft.presentationTypes.length,
            presentaciones: draft.presentations.length,
            productos: draft.products.length,
            productos_con_presentacion: productsWithPresentations,
            productos_sin_presentacion: productsWithoutPresentations,
            producto_presentaciones: draft.productPresentations.length
        },
        preview: {
            categorias: draft.categories.slice(0, 5),
            productos: draft.products.slice(0, 8),
            presentaciones: draft.presentations.slice(0, 8)
        }
    };
}

async function importMenuTemplateDraft(draft, userId) {
    const now = new Date().toISOString();
    const result = {
        created: { categorias: 0, subcategorias: 0, tipos_presentacion: 0, presentaciones: 0, productos: 0, producto_presentaciones: 0 },
        updated: { categorias: 0, subcategorias: 0, tipos_presentacion: 0, presentaciones: 0, productos: 0, producto_presentaciones: 0 },
        maps: { categories: {}, subcategories: {}, presentationTypes: {}, presentations: {}, products: {} }
    };

    for (const row of draft.categories) {
        const existing = await findCategoryByName(row.nombre, null);
        const active = templateYesNoToBool(row.activa, true);
        const cocina = templateYesNoToBool(row.permite_cocina, false);

        if (existing) {
            await database.run('UPDATE categorias SET nombre = ?, permite_cocina = ?, activa = ? WHERE id = ?', [row.nombre, cocina, active, existing.id]);
            result.updated.categorias += 1;
            result.maps.categories[normalizeLookupKey(row.clave_categoria)] = existing.id;
        } else {
            const inserted = await database.run('INSERT INTO categorias (nombre, parent_id, permite_cocina, activa) VALUES (?, NULL, ?, ?)', [row.nombre, cocina, active]);
            result.created.categorias += 1;
            result.maps.categories[normalizeLookupKey(row.clave_categoria)] = inserted.id;
        }
    }

    for (const row of draft.subcategories) {
        const parentId = result.maps.categories[normalizeLookupKey(row.clave_categoria)];
        if (!parentId) continue;
        const existing = await findCategoryByName(row.nombre, parentId);
        const active = templateYesNoToBool(row.activa, true);
        const cocina = templateYesNoToBool(row.permite_cocina, false);

        if (existing) {
            await database.run('UPDATE categorias SET nombre = ?, parent_id = ?, permite_cocina = ?, activa = ? WHERE id = ?', [row.nombre, parentId, cocina, active, existing.id]);
            result.updated.subcategorias += 1;
            result.maps.subcategories[normalizeLookupKey(row.clave_subcategoria)] = existing.id;
        } else {
            const inserted = await database.run('INSERT INTO categorias (nombre, parent_id, permite_cocina, activa) VALUES (?, ?, ?, ?)', [row.nombre, parentId, cocina, active]);
            result.created.subcategorias += 1;
            result.maps.subcategories[normalizeLookupKey(row.clave_subcategoria)] = inserted.id;
        }
    }

    for (const row of draft.presentationTypes) {
        const categoriaId = result.maps.categories[normalizeLookupKey(row.clave_categoria)];
        const subcategoriaId = row.clave_subcategoria ? result.maps.subcategories[normalizeLookupKey(row.clave_subcategoria)] || null : null;
        if (!categoriaId) continue;
        const active = templateYesNoToBool(row.activo, true);
        const existing = await findPresentationTypeByContext(row.nombre, categoriaId, subcategoriaId);

        if (existing) {
            await database.run(`
                UPDATE tipos_presentacion
                SET nombre = ?, descripcion = ?, categoria_id = ?, subcategoria_id = ?, activo = ?, actualizado_en = ?
                WHERE id = ?
            `, [row.nombre, row.descripcion || '', categoriaId, subcategoriaId, active, now, existing.id]);
            result.updated.tipos_presentacion += 1;
            result.maps.presentationTypes[normalizeLookupKey(row.clave_tipo)] = existing.id;
        } else {
            const inserted = await database.run(`
                INSERT INTO tipos_presentacion (nombre, descripcion, categoria_id, subcategoria_id, activo, creado_en, actualizado_en)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [row.nombre, row.descripcion || '', categoriaId, subcategoriaId, active, now, now]);
            result.created.tipos_presentacion += 1;
            result.maps.presentationTypes[normalizeLookupKey(row.clave_tipo)] = inserted.id;
        }
    }

    for (const row of draft.presentations) {
        const tipoPresentacionId = result.maps.presentationTypes[normalizeLookupKey(row.clave_tipo)];
        if (!tipoPresentacionId) continue;
        const active = templateYesNoToBool(row.activo, true);
        const existing = await findPresentationByContext(row.nombre, tipoPresentacionId);

        if (existing) {
            await database.run(`
                UPDATE presentaciones
                SET nombre = ?, tipo = ?, cantidad = ?, tipo_presentacion_id = ?, activo = ?, actualizado_en = ?
                WHERE id = ?
            `, [row.nombre, row.tipo || 'Tamaño', row.cantidad || null, tipoPresentacionId, active, now, existing.id]);
            result.updated.presentaciones += 1;
            result.maps.presentations[normalizeLookupKey(row.clave_presentacion)] = existing.id;
        } else {
            const inserted = await database.run(`
                INSERT INTO presentaciones (nombre, tipo, cantidad, tipo_presentacion_id, activo, creado_en, actualizado_en)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [row.nombre, row.tipo || 'Tamaño', row.cantidad || null, tipoPresentacionId, active, now, now]);
            result.created.presentaciones += 1;
            result.maps.presentations[normalizeLookupKey(row.clave_presentacion)] = inserted.id;
        }
    }

    for (const row of draft.products) {
        const categoriaId = result.maps.categories[normalizeLookupKey(row.clave_categoria)];
        const subcategoriaId = row.clave_subcategoria ? result.maps.subcategories[normalizeLookupKey(row.clave_subcategoria)] || null : null;
        const tipoPresentacionId = row.tiene_presentaciones === 'SI' ? result.maps.presentationTypes[normalizeLookupKey(row.clave_tipo)] || null : null;
        if (!categoriaId) continue;

        const active = templateYesNoToBool(row.activo, true);
        const destination = normalizeTemplatePreparationDestination(row);
        const cocina = destination === 'ninguno' ? 0 : 1;
        const hasPresentations = row.tiene_presentaciones === 'SI';
        const price = hasPresentations ? 0 : Number(row.precio_base || 0);
        const existing = await findProductByName(row.nombre);

        if (existing) {
            await database.run(`
                UPDATE productos
                SET nombre = ?, descripcion = ?, precio = ?, categoria_id = ?, subcategoria_id = ?,
                    es_cocina = ?, destino_preparacion = ?, tipo_presentacion_id = ?, activo = ?
                WHERE id = ?
            `, [
                row.nombre, row.descripcion || '', price, categoriaId, subcategoriaId,
                cocina, destination, tipoPresentacionId, active, existing.id
            ]);
            result.updated.productos += 1;
            result.maps.products[normalizeLookupKey(row.clave_producto)] = existing.id;
        } else {
            const inserted = await database.run(`
                INSERT INTO productos (
                    nombre, descripcion, precio, categoria_id, subcategoria_id,
                    es_cocina, destino_preparacion, imagen, tipo_presentacion_id, activo
                ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
            `, [
                row.nombre, row.descripcion || '', price, categoriaId, subcategoriaId,
                cocina, destination, tipoPresentacionId, active
            ]);
            result.created.productos += 1;
            result.maps.products[normalizeLookupKey(row.clave_producto)] = inserted.id;
        }
    }

    for (const row of draft.productPresentations) {
        const productId = result.maps.products[normalizeLookupKey(row.clave_producto)];
        const presentationId = result.maps.presentations[normalizeLookupKey(row.clave_presentacion)];
        if (!productId || !presentationId) continue;
        const price = Number(row.precio || 0);
        const active = templateYesNoToBool(row.activo, true);
        const existing = await database.get('SELECT id FROM presentaciones_producto WHERE producto_id = ? AND presentacion_id = ?', [productId, presentationId]);

        if (existing) {
            await database.run('UPDATE presentaciones_producto SET precio = ?, activo = ? WHERE id = ?', [price, active, existing.id]);
            result.updated.producto_presentaciones += 1;
        } else {
            await database.run('INSERT INTO presentaciones_producto (producto_id, presentacion_id, precio, activo) VALUES (?, ?, ?, ?)', [productId, presentationId, price, active]);
            result.created.producto_presentaciones += 1;
        }
    }

    await database.run(
        'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
        ['importar_menu_plantilla', userId, `Importación de menú desde plantilla: ${draft.products.length} productos procesados`, now]
    );

    return result;
}

function parseTemplateRequestBody(body = {}) {
    const filename = templateText(body.filename || body.nombre_archivo || 'plantilla-menu.xlsx');
    const fileBase64 = body.file_base64 || body.fileBase64 || body.archivo_base64 || '';
    const parsed = parseMenuTemplateWorkbook(fileBase64);
    const validation = validateMenuTemplateDraft(parsed.draft);
    const summary = buildTemplateImportSummary(parsed.draft, validation, parsed.structureErrors);
    return { filename, ...parsed, validation, summary };
}

router.post('/template/validate', requireMenuAdmin, async (req, res) => {
    try {
        const result = parseTemplateRequestBody(req.body || {});
        res.json({
            success: true,
            filename: result.filename,
            metadata: result.metadata,
            ...result.summary
        });
    } catch (error) {
        console.error('Error validando plantilla de menú:', error);
        res.status(400).json({ success: false, error: error.message || 'No se pudo validar la plantilla de menú' });
    }
});

router.post('/template/import', requireMenuAdmin, async (req, res) => {
    let transactionStarted = false;

    try {
        const result = parseTemplateRequestBody(req.body || {});
        if (!result.summary.can_import) {
            return res.status(400).json({
                success: false,
                error: 'La plantilla contiene errores críticos y no puede importarse.',
                errors: result.summary.errors,
                warnings: result.summary.warnings,
                summary: result.summary.summary
            });
        }

        await database.run('BEGIN');
        transactionStarted = true;
        const importResult = await importMenuTemplateDraft(result.draft, req.session.userId);
        await database.run('COMMIT');

        res.json({
            success: true,
            message: 'Menú importado correctamente desde plantilla.',
            filename: result.filename,
            metadata: result.metadata,
            summary: result.summary.summary,
            warnings: result.summary.warnings,
            result: { created: importResult.created, updated: importResult.updated }
        });
    } catch (error) {
        if (transactionStarted) await database.run('ROLLBACK').catch(() => {});
        console.error('Error importando plantilla de menú:', error);
        res.status(500).json({ success: false, error: error.message || 'Error interno importando plantilla de menú' });
    }
});


router.post('/template/generate', requireMenuAdmin, async (req, res) => {
    try {
        const draft = normalizeMenuTemplateDraft(req.body || {});
        const validation = validateMenuTemplateDraft(draft);

        if (validation.errors.length > 0) {
            return res.status(400).json({
                error: 'La plantilla asistida contiene errores críticos.',
                errors: validation.errors,
                warnings: validation.warnings
            });
        }

        const workbook = buildMenuTemplateWorkbook(draft, validation);
        const safeDate = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const filename = `mundipos-menu-template-${safeDate}.xlsx`;

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', workbook.length);
        res.send(workbook);
    } catch (error) {
        console.error('Error generando plantilla de menú:', error);
        res.status(500).json({ error: 'Error interno generando plantilla de menú' });
    }
});


module.exports = router;
