const express = require("express");
const database = require("../db/database");

const router = express.Router();


function clampServicePercentage(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) return 0;
    if (number > 100) return 100;
    return number;
}

function calculateService(subtotal, aplicaServicio, porcentajeServicio) {
    const cleanSubtotal = Number(subtotal) || 0;
    const cleanPercentage = clampServicePercentage(porcentajeServicio);
    const service = aplicaServicio ? cleanSubtotal * (cleanPercentage / 100) : 0;
    return {
        subtotal: cleanSubtotal,
        aplica_servicio: aplicaServicio ? 1 : 0,
        porcentaje_servicio: aplicaServicio ? cleanPercentage : 0,
        monto_servicio: service,
        total_con_servicio: cleanSubtotal + service
    };
}

function isActive(value) {
    return Number(value ?? 1) === 1;
}

async function getOperationalProductForOrder(productoId) {
    const product = await database.get(`
        SELECT
            p.*,
            COALESCE(p.activo, 1) AS producto_activo,
            c.nombre AS categoria_nombre,
            COALESCE(c.activa, 1) AS categoria_activa,
            s.nombre AS subcategoria_nombre,
            COALESCE(s.activa, 1) AS subcategoria_activa
        FROM productos p
        JOIN categorias c ON p.categoria_id = c.id
        LEFT JOIN categorias s ON p.subcategoria_id = s.id
        WHERE p.id = ?
    `, [productoId]);

    if (!product) {
        return { ok: false, error: `Producto con ID ${productoId} no encontrado` };
    }

    if (!isActive(product.producto_activo)) {
        return { ok: false, error: `El producto ${product.nombre} está inactivo` };
    }

    if (!isActive(product.categoria_activa)) {
        return { ok: false, error: `La categoría de ${product.nombre} está inactiva` };
    }

    if (product.subcategoria_id && !isActive(product.subcategoria_activa)) {
        return { ok: false, error: `La subcategoría de ${product.nombre} está inactiva` };
    }

    return { ok: true, product };
}

async function getOperationalPresentationForOrder(productoId, presentacionId) {
    return database.get(`
        SELECT
            pp.id AS producto_presentacion_id,
            pp.producto_id,
            pp.presentacion_id,
            pp.precio,
            COALESCE(pp.activo, 1) AS relacion_activa,
            pr.nombre AS presentacion_nombre,
            pr.cantidad AS presentacion_cantidad,
            pr.tipo_presentacion_id,
            COALESCE(pr.activo, 1) AS presentacion_activa,
            p.tipo_presentacion_id AS producto_tipo_presentacion_id
        FROM presentaciones_producto pp
        JOIN presentaciones pr ON pp.presentacion_id = pr.id
        JOIN productos p ON p.id = pp.producto_id
        WHERE pp.producto_id = ?
          AND (pp.id = ? OR pp.presentacion_id = ?)
          AND COALESCE(pp.activo, 1) = 1
          AND COALESCE(pr.activo, 1) = 1
          AND COALESCE(pp.precio, 0) > 0
          AND (p.tipo_presentacion_id IS NULL OR pr.tipo_presentacion_id = p.tipo_presentacion_id)
        LIMIT 1
    `, [productoId, presentacionId, presentacionId]);
}

async function validateOrderProductItem(item) {
    const productoId = parseInt(item?.producto_id, 10);
    const cantidad = parseInt(item?.cantidad, 10);

    if (!productoId || !cantidad || cantidad <= 0) {
        return { ok: false, skip: true };
    }

    const productResult = await getOperationalProductForOrder(productoId);
    if (!productResult.ok) {
        return productResult;
    }

    const product = productResult.product;
    let precioUnitario = Number(product.precio || 0);
    let presentacionId = null;

    if (item.presentacion_id !== null && typeof item.presentacion_id !== 'undefined') {
        const presentation = await getOperationalPresentationForOrder(productoId, item.presentacion_id);

        if (!presentation) {
            return { ok: false, error: `Presentación no válida para el producto ${product.nombre}` };
        }

        precioUnitario = Number(presentation.precio || 0);
        presentacionId = Number(presentation.presentacion_id);
    } else {
        const hasOperationalPresentations = await database.get(`
            SELECT 1 AS exists_flag
            FROM presentaciones_producto pp
            JOIN presentaciones pr ON pp.presentacion_id = pr.id
            WHERE pp.producto_id = ?
              AND COALESCE(pp.activo, 1) = 1
              AND COALESCE(pr.activo, 1) = 1
              AND COALESCE(pp.precio, 0) > 0
            LIMIT 1
        `, [productoId]);

        if (hasOperationalPresentations) {
            return { ok: false, error: `Debe seleccionar una presentación para ${product.nombre}` };
        }

        if (!Number.isFinite(precioUnitario) || precioUnitario <= 0) {
            return { ok: false, error: `El producto ${product.nombre} no tiene precio operativo válido` };
        }
    }

    return {
        ok: true,
        item: {
            producto_id: productoId,
            cantidad,
            precio_unitario: precioUnitario,
            precio_original: precioUnitario,
            presentacion_id: presentacionId,
            es_cocina: Number(product.es_cocina) === 1 ? 1 : 0
        }
    };
}

async function getSeatServicePolicy(mesaId) {
    const row = await database.get(`
        SELECT
            m.id,
            m.aplica_servicio_override,
            m.porcentaje_servicio_override,
            z.aplica_servicio AS zona_aplica_servicio,
            z.porcentaje_servicio AS zona_porcentaje_servicio
        FROM mesas m
        LEFT JOIN zonas z ON z.id = m.zona_id
        WHERE m.id = ?
    `, [mesaId]);

    const aplica = row?.aplica_servicio_override !== null && typeof row?.aplica_servicio_override !== 'undefined'
        ? Number(row.aplica_servicio_override) === 1
        : Number(row?.zona_aplica_servicio || 0) === 1;

    const porcentajeRaw = row?.porcentaje_servicio_override !== null && typeof row?.porcentaje_servicio_override !== 'undefined'
        ? row.porcentaje_servicio_override
        : row?.zona_porcentaje_servicio;

    return {
        aplica_servicio: aplica ? 1 : 0,
        porcentaje_servicio: aplica ? clampServicePercentage(porcentajeRaw ?? 10) : 0
    };
}

async function resolveOrderServicePolicy(order) {
    if (order && order.aplica_servicio !== null && typeof order.aplica_servicio !== 'undefined') {
        return {
            aplica_servicio: Number(order.aplica_servicio) === 1 ? 1 : 0,
            porcentaje_servicio: Number(order.aplica_servicio) === 1
                ? clampServicePercentage(order.porcentaje_servicio ?? 10)
                : 0
        };
    }

    return getSeatServicePolicy(order.mesa_id);
}

async function updateOrderServiceTotals(pedidoId) {
    const pedido = await database.get('SELECT * FROM pedidos WHERE id = ?', [pedidoId]);
    if (!pedido) return null;

    const subtotalRow = await database.get(`
        SELECT COALESCE(SUM(precio_unitario * cantidad), 0) AS subtotal
        FROM pedido_productos
        WHERE pedido_id = ?
    `, [pedidoId]);

    const policy = await resolveOrderServicePolicy(pedido);
    const totals = calculateService(subtotalRow?.subtotal || 0, Number(policy.aplica_servicio) === 1, policy.porcentaje_servicio);

    await database.run(`
        UPDATE pedidos
        SET total = ?,
            aplica_servicio = ?,
            porcentaje_servicio = ?,
            monto_servicio = ?,
            total_con_servicio = ?
        WHERE id = ?
    `, [
        totals.subtotal,
        totals.aplica_servicio,
        totals.porcentaje_servicio,
        totals.monto_servicio,
        totals.total_con_servicio,
        pedidoId
    ]);

    return totals;
}

function enrichOrderWithService(order = {}) {
    const subtotal = Number(order.total) || 0;
    const aplica = Number(order.aplica_servicio || 0) === 1;
    const porcentaje = aplica ? clampServicePercentage(order.porcentaje_servicio ?? 10) : 0;
    const servicio = Number.isFinite(Number(order.monto_servicio)) ? Number(order.monto_servicio) : (aplica ? subtotal * (porcentaje / 100) : 0);
    const totalConServicio = Number.isFinite(Number(order.total_con_servicio)) && order.total_con_servicio !== null
        ? Number(order.total_con_servicio)
        : subtotal + servicio;

    return {
        ...order,
        subtotal,
        aplica_servicio: aplica ? 1 : 0,
        porcentaje_servicio: porcentaje,
        monto_servicio: servicio,
        total_con_servicio: totalConServicio
    };
}


// Obtener todos los pedidos
router.get("/", async (req, res) => {
    try {
        const { estado, mesa_id } = req.query;
        
        let whereClause = "";
        let params = [];
        
        if (estado) {
            whereClause += " WHERE p.estado = ?";
            params.push(estado);
        }
        
        if (mesa_id) {
            whereClause += estado ? " AND p.mesa_id = ?" : " WHERE p.mesa_id = ?";
            params.push(mesa_id);
        }

        const pedidos = await database.all(`
            SELECT p.*, 
                m.numero as mesa_numero,
                m.tipo_asiento as mesa_tipo,
                u.nombre as usuario_nombre

            FROM pedidos p
            JOIN mesas m ON p.mesa_id = m.id
            JOIN usuarios u ON p.usuario_id = u.id
            ${whereClause}
            ORDER BY p.fecha DESC
        `, params);
        
        res.json({ success: true, data: pedidos.map(enrichOrderWithService) });
    } catch (error) {
        console.error("Error obteniendo pedidos:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

// Obtener un pedido específico con sus productos
router.get("/:id", async (req, res) => {
    try {
        const { id } = req.params;
        
       const pedido = await database.get(`
    SELECT p.*, 
           m.numero as mesa_numero,
           m.tipo_asiento as mesa_tipo,
           COALESCE(p.cliente_nombre, m.cliente_nombre) as cliente_nombre,
           u.nombre as usuario_nombre
    FROM pedidos p
    JOIN mesas m ON p.mesa_id = m.id
    JOIN usuarios u ON p.usuario_id = u.id
    WHERE p.id = ?
`, [id]);

        if (!pedido) {
            return res.status(404).json({ error: "Pedido no encontrado" });
        }

const productos = await database.all(`
  SELECT 
  pp.*, 
  pr.nombre AS producto_nombre,
  pr.descripcion AS producto_descripcion,
  COALESCE(pres.nombre, '') AS presentacion_nombre,
  COALESCE(pres.cantidad, '') AS presentacion_cantidad
FROM pedido_productos pp
JOIN productos pr ON pp.producto_id = pr.id
LEFT JOIN presentaciones_producto ppres 
  ON pp.producto_id = ppres.producto_id AND pp.presentacion_id = ppres.presentacion_id
LEFT JOIN presentaciones pres 
  ON ppres.presentacion_id = pres.id
WHERE pp.pedido_id = ?
`, [id]);


const serviceTotals = await updateOrderServiceTotals(pedido.id);
if (serviceTotals) Object.assign(pedido, serviceTotals);
pedido.productos = productos;

        
        res.json({ success: true, data: enrichOrderWithService(pedido) });
    } catch (error) {
        console.error("Error obteniendo pedido:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

// Crear nuevo pedido
router.post("/", async (req, res) => {
  try {
    const { mesa_id, productos } = req.body;

    if (!mesa_id || !productos || productos.length === 0) {
      return res.status(400).json({ error: "Zona y productos son requeridos" });
    }

    const mesa = await database.get("SELECT * FROM mesas WHERE id = ?", [mesa_id]);
    if (!mesa) {
      return res.status(400).json({ error: "Zona no encontrada" });
    }

    const nombreZona = mesa.zona?.toLowerCase() === 'barra' ? 'banco' : 'mesa';

    if (mesa.estado !== 'ocupada') {
      return res.status(400).json({
        error: `El ${nombreZona} no está ocupad${nombreZona === 'banco' ? 'o' : 'a'}`
      });
    }

    const pedidoPendienteExistente = await database.get(
      "SELECT id FROM pedidos WHERE mesa_id = ? AND estado = ? LIMIT 1",
      [mesa_id, "pendiente"]
    );

    if (pedidoPendienteExistente) {
      return res.status(409).json({
        error: `El ${nombreZona} ya tiene una cuenta pendiente abierta. Actualiza la vista antes de continuar.`,
        pedido_id: pedidoPendienteExistente.id
      });
    }

    const userId = req.session?.userId || null;
    const servicePolicy = await getSeatServicePolicy(mesa_id);

    // Calcular total
    let total = 0;
    const productosValidados = [];

    for (const item of productos) {
      const validation = await validateOrderProductItem(item);
      if (validation.skip) continue;
      if (!validation.ok) {
        return res.status(400).json({ error: validation.error || 'Producto no válido para operación' });
      }

      total += validation.item.precio_unitario * validation.item.cantidad;
      productosValidados.push(validation.item);
    }

    if (productosValidados.length === 0) {
      return res.status(400).json({ error: 'No hay productos operativos válidos para crear el pedido' });
    }

    const serviceTotals = calculateService(total, Number(servicePolicy.aplica_servicio) === 1, servicePolicy.porcentaje_servicio);

    // Crear pedido con snapshot de servicio según la zona/puesto actual
    const pedidoResult = await database.run(
      `INSERT INTO pedidos (
          mesa_id, usuario_id, fecha, estado, total, cliente_nombre,
          aplica_servicio, porcentaje_servicio, monto_servicio, total_con_servicio
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        mesa_id,
        userId,
        new Date().toISOString(),
        "pendiente",
        serviceTotals.subtotal,
        mesa.cliente_nombre,
        serviceTotals.aplica_servicio,
        serviceTotals.porcentaje_servicio,
        serviceTotals.monto_servicio,
        serviceTotals.total_con_servicio
      ]
    );

    const pedidoId = pedidoResult.id;

    // Guardar productos
    for (const item of productosValidados) {
      await database.run(
        `INSERT INTO pedido_productos
         (pedido_id, producto_id, cantidad, precio_unitario, precio_original, presentacion_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          pedidoId,
          item.producto_id,
          item.cantidad,
          item.precio_unitario,
          item.precio_original,
          item.presentacion_id
        ]
      );
    }

    // Comanda cocina (si aplica)
    const productosCocina = productosValidados.filter(item => item.es_cocina);
    let comandaId = null;

    if (productosCocina.length > 0) {
      const comandaResult = await database.run(
        `INSERT INTO comandas (mesa_id, productos_cocina, fecha_impresion, estado)
         VALUES (?, ?, ?, ?)`,
        [mesa_id, JSON.stringify(productosCocina), new Date().toISOString(), "pendiente"]
      );
      comandaId = comandaResult.id;
    }

    // Historial
    await database.run(
      `INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha)
       VALUES (?, ?, ?, ?)`,
      [`crear_pedido_${nombreZona}`, userId, `Pedido creado para ${nombreZona} ${mesa.numero}`, new Date().toISOString()]
    );

    res.json({
      success: true,
      data: {
        id: pedidoId,
        total: serviceTotals.total_con_servicio,
        subtotal: serviceTotals.subtotal,
        servicio: serviceTotals.monto_servicio,
        aplica_servicio: serviceTotals.aplica_servicio,
        porcentaje_servicio: serviceTotals.porcentaje_servicio,
        comanda_id: comandaId,
        requiere_comanda: productosCocina.length > 0
      }
    });

  } catch (error) {
    console.error("❌ Error creando pedido:");
    console.error("Mensaje:", error.message);
    console.error("Stack:", error.stack);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// Agregar productos a un pedido existente
router.post("/:id/products", async (req, res) => {
    try {
        const { id } = req.params;
        const { productos } = req.body;

        if (!productos || productos.length === 0) {
            return res.status(400).json({ error: "Productos son requeridos" });
        }

        // Verificar que el pedido existe y está pendiente
        const pedido = await database.get("SELECT * FROM pedidos WHERE id = ? AND estado = ?", [id, "pendiente"]);
        if (!pedido) {
            return res.status(400).json({ error: "Pedido no encontrado o ya está procesado" });
        }

        // Obtener zona (mesa) relacionada para personalizar historial
        const zona = await database.get("SELECT numero, zona, tipo_asiento FROM mesas WHERE id = ?", [pedido.mesa_id]);
        const nombreZona = zona?.zona?.toLowerCase() === 'bar'
            ? (zona.tipo_asiento?.toLowerCase() === 'banco' ? 'banco' : 'mesa')
            : 'mesa';

        let totalAdicional = 0;
        const productosValidados = [];

        for (const item of productos) {
            const validation = await validateOrderProductItem(item);
            if (validation.skip) continue;
            if (!validation.ok) {
                return res.status(400).json({ error: validation.error || 'Producto no válido para operación' });
            }

            const subtotal = validation.item.precio_unitario * validation.item.cantidad;
            totalAdicional += subtotal;
            productosValidados.push(validation.item);
        }

        if (productosValidados.length === 0) {
            return res.status(400).json({ error: 'No hay productos operativos válidos para agregar al pedido' });
        }

        // Agregar productos al pedido
// Agregar productos al pedido (consolidando si ya existen)
for (const item of productosValidados) {
    const existente = await database.get(
        "SELECT id, cantidad FROM pedido_productos WHERE pedido_id = ? AND producto_id = ? AND COALESCE(presentacion_id, 0) = COALESCE(?, 0)",
        [id, item.producto_id, item.presentacion_id]
    );

    if (existente) {
        // Si el producto ya existe, actualizar la cantidad
        await database.run(
            "UPDATE pedido_productos SET cantidad = cantidad + ? WHERE id = ?",
            [item.cantidad, existente.id]
        );
    } else {
        // Si no existe, insertar nuevo
        await database.run(
            "INSERT INTO pedido_productos (pedido_id, producto_id, cantidad, precio_unitario, precio_original, presentacion_id) VALUES (?, ?, ?, ?, ?, ?)",
            [id, item.producto_id, item.cantidad, item.precio_unitario, item.precio_original, item.presentacion_id]
        );
    }
}


        // Recalcular subtotal y servicio del pedido con el snapshot guardado al abrir la cuenta
        const serviceTotals = await updateOrderServiceTotals(id);

        // Verificar si hay productos de cocina para generar comanda adicional
        const productosCocina = productosValidados.filter(item => item.es_cocina);
        let comandaId = null;

        if (productosCocina.length > 0) {
            const comandaResult = await database.run(
                "INSERT INTO comandas (mesa_id, productos_cocina, fecha_impresion, estado) VALUES (?, ?, ?, ?)",
                [pedido.mesa_id, JSON.stringify(productosCocina), new Date().toISOString(), "pendiente"]
            );
            comandaId = comandaResult.id;
        }

        // Registrar en historial con nombreZona
        await database.run(
            "INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)",
            [`agregar_productos_${nombreZona}`, req.session.userId, `Productos agregados al pedido ${id} (${nombreZona} ${zona.numero})`, new Date().toISOString()]
        );

        res.json({
            success: true,
            data: {
                total_adicional: totalAdicional,
                subtotal: serviceTotals?.subtotal || 0,
                servicio: serviceTotals?.monto_servicio || 0,
                total: serviceTotals?.total_con_servicio || 0,
                aplica_servicio: serviceTotals?.aplica_servicio || 0,
                porcentaje_servicio: serviceTotals?.porcentaje_servicio || 0,
                comanda_id: comandaId,
                requiere_comanda: productosCocina.length > 0
            }
        });
    } catch (error) {
        console.error("Error agregando productos al pedido:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

// Editar producto en pedido (reglas de negocio)
router.put("/:pedido_id/products/:producto_id", async (req, res) => {
    try {
        const { pedido_id, producto_id } = req.params;
        const { nuevo_producto_id, admin_password } = req.body;

        // Verificar que el pedido existe y está pendiente
        const pedido = await database.get("SELECT * FROM pedidos WHERE id = ? AND estado = ?", [pedido_id, "pendiente"]);
        if (!pedido) {
            return res.status(400).json({ error: "Pedido no encontrado o ya está procesado" });
        }

        // Obtener el producto actual en el pedido
        const productoActual = await database.get(`
            SELECT pp.*, p.precio as precio_actual, p.nombre as nombre_actual
            FROM pedido_productos pp
            JOIN productos p ON pp.producto_id = p.id
            WHERE pp.pedido_id = ? AND pp.producto_id = ?
        `, [pedido_id, producto_id]);

        if (!productoActual) {
            return res.status(404).json({ error: "Producto no encontrado en el pedido" });
        }

        // Obtener el nuevo producto
        const nuevoProducto = await database.get("SELECT * FROM productos WHERE id = ?", [nuevo_producto_id]);
        if (!nuevoProducto) {
            return res.status(400).json({ error: "Nuevo producto no encontrado" });
        }

        // Aplicar reglas de negocio
        const precioOriginal = productoActual.precio_original;
        const nuevoPrecio = nuevoProducto.precio;

        // Si el nuevo precio es menor, requiere autorización de administrador
        if (nuevoPrecio < precioOriginal) {
            if (!admin_password) {
                return res.status(403).json({
                    error: "Se requiere contraseña de administrador para cambiar a un producto de menor valor",
                    requires_admin: true
                });
            }

            // Verificar contraseña de administrador
            const bcrypt = require("bcryptjs");
            const admin = await database.get("SELECT * FROM usuarios WHERE tipo = ? AND activo = 1 LIMIT 1", ["administrador"]);

            if (!admin || !await bcrypt.compare(admin_password, admin.password)) {
                return res.status(401).json({ error: "Contraseña de administrador incorrecta" });
            }
        }

        // Actualizar el producto en el pedido
        await database.run(
            "UPDATE pedido_productos SET producto_id = ?, precio_unitario = ? WHERE pedido_id = ? AND producto_id = ?",
            [nuevo_producto_id, nuevoPrecio, pedido_id, producto_id]
        );

        // Recalcular subtotal y servicio del pedido con el snapshot guardado al abrir la cuenta
        await updateOrderServiceTotals(pedido_id);

        // Obtener tipo y número de la zona (mesa) para historial
        const zona = await database.get("SELECT numero, zona, tipo_asiento FROM mesas WHERE id = ?", [pedido.mesa_id]);
        const nombreZona = zona?.zona?.toLowerCase() === 'bar'
            ? (zona.tipo_asiento?.toLowerCase() === 'banco' ? 'banco' : 'mesa')
            : 'mesa';

        // Registrar en historial
        await database.run(
            "INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)",
            [
                `editar_producto_${nombreZona}`,
                req.session.userId,
                `Producto cambiado de ${productoActual.nombre_actual} a ${nuevoProducto.nombre} en pedido ${pedido_id} (${nombreZona} ${zona.numero})`,
                new Date().toISOString()
            ]
        );

        res.json({ success: true, message: "Producto actualizado exitosamente" });
    } catch (error) {
        console.error("Error editando producto en pedido:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

// Procesar pago de pedido
router.post("/:id/pay", async (req, res) => {
    try {
        const { id } = req.params;
        const { metodo_pago, productos_divididos, admin_pass } = req.body;

        if (!metodo_pago) {
            return res.status(400).json({ error: "Método de pago es requerido" });
        }

        // Verificar que el pedido existe y está pendiente
        const pedido = await database.get(`
            SELECT p.*, m.numero as mesa_numero, m.zona, m.tipo_asiento
            FROM pedidos p
            JOIN mesas m ON p.mesa_id = m.id
            WHERE p.id = ? AND p.estado = ?
        `, [id, "pendiente"]);

        if (!pedido) {
            return res.status(400).json({ error: "Pedido no encontrado o ya está procesado" });
        }

        const syncedTotals = await updateOrderServiceTotals(id);
        if (syncedTotals) Object.assign(pedido, syncedTotals);

        const nombreZona = pedido.zona?.toLowerCase() === 'bar'
        ? (pedido.tipo_asiento?.toLowerCase() === 'banco' ? 'banco' : 'mesa')
        : 'mesa';


        let montoAPagar = pedido.total;

        if (productos_divididos && productos_divididos.length > 0) {
            const productosSeleccionados = await database.all(`
                SELECT SUM(precio_unitario * cantidad) as subtotal
                FROM pedido_productos
                WHERE pedido_id = ? AND id IN (${productos_divididos.map(() => "?").join(",")})
            `, [id, ...productos_divididos]);

            montoAPagar = productosSeleccionados[0].subtotal || 0;
        }

        const servicePayment = calculateService(
            montoAPagar,
            Number(pedido.aplica_servicio) === 1,
            pedido.porcentaje_servicio
        );
        const subtotal = servicePayment.subtotal;
        const servicio = servicePayment.monto_servicio;
        const total = servicePayment.total_con_servicio;

        // 🔐 PROCESO DE CRÉDITO
        if (metodo_pago === 'credito') {
            const bcrypt = require("bcryptjs");

            const admin = await database.get("SELECT * FROM usuarios WHERE tipo = ? AND activo = 1 LIMIT 1", ["administrador"]);
            if (!admin || !await bcrypt.compare(admin_pass || "", admin.password)) {
                return res.status(401).json({ error: "Contraseña de administrador incorrecta" });
            }

            // 1. Actualizar estado del pedido a 'credito'
            await database.run("UPDATE pedidos SET estado = ? WHERE id = ?", ["credito", id]);

            // 2. Liberar la mesa
            await database.run("UPDATE mesas SET estado = ?, cliente_nombre = NULL, fecha_apertura = NULL, cantidad_personas = NULL, hora_estimada = NULL WHERE id = ?", ["libre", pedido.mesa_id]);

            // 3. Registrar en historial
            await database.run(
                "INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)",
                [`credito_${nombreZona}`, req.session.userId, `Pedido #${pedido.id} registrado como crédito en ${nombreZona} ${pedido.mesa_numero}`, new Date().toISOString()]
            );

            // 4. Registrar en cuentas_credito
            await database.run(`
                INSERT INTO cuentas_credito (pedido_id, cliente_nombre, monto_total, fecha, usuario_origen, autorizado_por, mesa)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [
                pedido.id,
                pedido.cliente_nombre || '',
                total,
                new Date().toISOString(),
                req.session.userName || req.session.userNombre || 'usuario_desconocido',
                admin.nombre,
                `${nombreZona} ${pedido.mesa_numero}`
            ]);

            // 5. Devolver respuesta
            return res.json({
                success: true,
                data: {
                    subtotal,
                    servicio,
                    total,
                    metodo_pago,
                    aplica_servicio: servicePayment.aplica_servicio,
                    porcentaje_servicio: servicePayment.porcentaje_servicio,
                    mesa_numero: pedido.mesa_numero,
                    mensaje: `Saldo pendiente de pago - ₡${Number(total).toLocaleString('es-CR', { minimumFractionDigits: 2 })}`

                }
            });
        }

        // 🟢 SI NO ES CRÉDITO, PROCESAR COMO PAGO NORMAL
        await database.run(
            `INSERT INTO pagos (
                pedido_id, metodo_pago, monto, subtotal, servicio,
                porcentaje_servicio, aplica_servicio, fecha
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                id,
                metodo_pago,
                total,
                subtotal,
                servicio,
                servicePayment.porcentaje_servicio,
                servicePayment.aplica_servicio,
                new Date().toISOString()
            ]
        );

        if (!productos_divididos || productos_divididos.length === 0) {
            await database.run("UPDATE pedidos SET estado = ? WHERE id = ?", ["pagado", id]);
            await database.run(
                "UPDATE mesas SET estado = ?, cliente_nombre = NULL, fecha_apertura = NULL, cantidad_personas = NULL, hora_estimada = NULL WHERE id = ?",
                ["libre", pedido.mesa_id]
            );
        }

        await database.run(
            "INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)",
            [`procesar_pago_${nombreZona}`, req.session.userId, `Pago procesado para ${nombreZona} ${pedido.mesa_numero} - $${total}`, new Date().toISOString()]
        );

        res.json({
            success: true,
            data: {
                subtotal,
                servicio,
                total,
                metodo_pago,
                aplica_servicio: servicePayment.aplica_servicio,
                porcentaje_servicio: servicePayment.porcentaje_servicio,
                mesa_numero: pedido.mesa_numero
            }
        });

    } catch (error) {
        console.error("Error procesando pago:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

// Obtener comandas pendientes
router.get("/comandas/pending", async (req, res) => {
    try {
        const comandas = await database.all(`
            SELECT c.*, m.numero as mesa_numero
            FROM comandas c
            JOIN mesas m ON c.mesa_id = m.id
            WHERE c.estado = "pendiente"
            ORDER BY c.fecha_impresion
        `);
        
        res.json({ success: true, data: comandas });
    } catch (error) {
        console.error("Error obteniendo comandas:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

// Marcar comanda como impresa
router.put("/comandas/:id/print", async (req, res) => {
    try {
        const { id } = req.params;

        await database.run("UPDATE comandas SET estado = ? WHERE id = ?", ["impresa", id]);

        res.json({ success: true, message: "Comanda marcada como impresa" });
    } catch (error) {
        console.error("Error marcando comanda como impresa:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

module.exports = router;


