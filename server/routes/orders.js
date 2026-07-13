const express = require("express");
const database = require("../db/database");

const router = express.Router();

function isAdminSession(req) {
  return req.session?.userType === 'administrador';
}

function getSessionUserId(req) {
  return Number(req.session?.userId || 0);
}

function getSessionActiveWorkRoleId(req) {
  return Number(req.session?.activeWorkRoleId || 0) || null;
}

async function getMesaResponsibilitySummary(mesaId, currentUserId = 0) {
  const summary = await database.get(`
    SELECT
      COUNT(DISTINCT mr.usuario_id) AS responsables_total,
      SUM(CASE WHEN mr.usuario_id = ? THEN 1 ELSE 0 END) AS soy_responsable
    FROM mesa_responsables mr
    INNER JOIN usuarios u ON u.id = mr.usuario_id AND u.activo = 1
    WHERE mr.mesa_id = ?
  `, [Number(currentUserId || 0), mesaId]);

  return {
    responsables_total: Number(summary?.responsables_total || 0),
    soy_responsable: Number(summary?.soy_responsable || 0) > 0
  };
}

async function canOperateMesa(req, mesaId) {
  if (isAdminSession(req)) return true;
  const summary = await getMesaResponsibilitySummary(mesaId, getSessionUserId(req));
  return summary.soy_responsable;
}

async function requireMesaOperationAccess(req, res, mesaId) {
  if (await canOperateMesa(req, mesaId)) return true;
  res.status(403).json({
    error: 'Responsable asignado. No puedes operar esta mesa/cuenta con tu usuario actual.',
    code: 'MESA_ASSIGNED_TO_OTHER_USER'
  });
  return false;
}

async function ensureMesaResponsibility(mesaId, req, actionLabel = 'responsable_mesa_asignado_pedido') {
  const userId = getSessionUserId(req);
  if (!userId) return;

  const summary = await getMesaResponsibilitySummary(mesaId, userId);
  if (summary.soy_responsable || summary.responsables_total > 0) return;

  await database.run(`
    INSERT OR IGNORE INTO mesa_responsables (
      mesa_id, usuario_id, rol_trabajo_id, asignado_por_usuario_id, fecha_asignacion
    ) VALUES (?, ?, ?, ?, ?)
  `, [mesaId, userId, getSessionActiveWorkRoleId(req), userId, new Date().toISOString()]);

  await database.run(
    'INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)',
    [actionLabel, userId, `Usuario asignado como responsable operativo de mesa/puesto #${mesaId}`, new Date().toISOString()]
  );
}

async function clearMesaResponsibilities(mesaId) {
  await database.run('DELETE FROM mesa_responsables WHERE mesa_id = ?', [mesaId]);
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
        
        res.json({ success: true, data: pedidos });
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


pedido.productos = productos;


        
        res.json({ success: true, data: pedido });
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

    if (!(await requireMesaOperationAccess(req, res, mesa_id))) return;
    await ensureMesaResponsibility(mesa_id, req);

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

    // Calcular total
    let total = 0;
    const productosValidados = [];

    for (const item of productos) {
      const { producto_id, cantidad, presentacion_id, precio } = item;

      if (!producto_id || !cantidad || cantidad <= 0) continue;

      let precioUnitario = 0;
      let es_cocina = 0;

      if (typeof presentacion_id !== 'undefined' && presentacion_id !== null) {
        const result = await database.get(
          `SELECT pp.precio, p.es_cocina, pp.producto_id, pp.presentacion_id
           FROM presentaciones_producto pp
           JOIN productos p ON p.id = pp.producto_id
           WHERE pp.producto_id = ?
             AND pp.activo = 1
             AND (pp.id = ? OR pp.presentacion_id = ?)`,
          [producto_id, presentacion_id, presentacion_id]
        );
        if (!result) continue;
        precioUnitario = result.precio;
        es_cocina = result.es_cocina;
        item.presentacion_id = result.presentacion_id;
      } else if (typeof precio !== 'undefined' && Number.isFinite(Number(precio))) {
        const producto = await database.get(
          `SELECT es_cocina FROM productos WHERE id = ?`,
          [producto_id]
        );
        if (!producto) continue;
        precioUnitario = parseFloat(precio);
        es_cocina = producto.es_cocina;
      } else {
        const producto = await database.get(
          `SELECT precio, es_cocina FROM productos WHERE id = ?`,
          [producto_id]
        );
        if (!producto) continue;
        precioUnitario = producto.precio;
        es_cocina = producto.es_cocina;
      }


      total += precioUnitario * cantidad;

      productosValidados.push({
        producto_id,
        cantidad,
        precio_unitario: precioUnitario,
        precio_original: precioUnitario,
        presentacion_id: (typeof item.presentacion_id !== 'undefined') ? item.presentacion_id : null,
        es_cocina
      });
    }

    // Crear pedido
    const pedidoResult = await database.run(
      `INSERT INTO pedidos (mesa_id, usuario_id, rol_trabajo_id, fecha, estado, total, cliente_nombre)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [mesa_id, userId, getSessionActiveWorkRoleId(req), new Date().toISOString(), "pendiente", total, mesa.cliente_nombre]
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
        total,
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

        if (!(await requireMesaOperationAccess(req, res, pedido.mesa_id))) return;

        // Obtener zona (mesa) relacionada para personalizar historial
        const zona = await database.get("SELECT numero, zona, tipo_asiento FROM mesas WHERE id = ?", [pedido.mesa_id]);
        const nombreZona = zona?.zona?.toLowerCase() === 'bar'
            ? (zona.tipo_asiento?.toLowerCase() === 'banco' ? 'banco' : 'mesa')
            : 'mesa';

        let totalAdicional = 0;
        const productosValidados = [];

        for (const item of productos) {
            const producto = await database.get("SELECT * FROM productos WHERE id = ?", [item.producto_id]);
            if (!producto) {
                return res.status(400).json({ error: `Producto con ID ${item.producto_id} no encontrado` });
            }

            let precioUnitario = Number.isFinite(Number(item.precio)) ? Number(item.precio) : producto.precio;
            let presentacionId = item.presentacion_id ?? null;

            if (presentacionId !== null && typeof presentacionId !== 'undefined') {
                const presentacion = await database.get(`
                    SELECT pp.precio, pp.presentacion_id
                    FROM presentaciones_producto pp
                    WHERE pp.producto_id = ?
                      AND pp.activo = 1
                      AND (pp.id = ? OR pp.presentacion_id = ?)
                `, [item.producto_id, presentacionId, presentacionId]);

                if (!presentacion) {
                    return res.status(400).json({ error: `Presentación no válida para el producto ${producto.nombre}` });
                }

                precioUnitario = presentacion.precio;
                presentacionId = presentacion.presentacion_id;
            }

            const cantidad = parseInt(item.cantidad, 10);
            if (!cantidad || cantidad <= 0) continue;

            const subtotal = precioUnitario * cantidad;
            totalAdicional += subtotal;

            productosValidados.push({
                producto_id: item.producto_id,
                cantidad,
                precio_unitario: precioUnitario,
                precio_original: precioUnitario,
                es_cocina: producto.es_cocina,
                presentacion_id: presentacionId
            });

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


        // Actualizar total del pedido
        await database.run(
            "UPDATE pedidos SET total = total + ? WHERE id = ?",
            [totalAdicional, id]
        );

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

        if (!(await requireMesaOperationAccess(req, res, pedido.mesa_id))) return;

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

        // Recalcular total del pedido
        const nuevoTotal = await database.get(`
            SELECT SUM(precio_unitario * cantidad) as total
            FROM pedido_productos
            WHERE pedido_id = ?
        `, [pedido_id]);

        await database.run("UPDATE pedidos SET total = ? WHERE id = ?", [nuevoTotal.total, pedido_id]);

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
        const { metodo_pago, productos_divididos, aplicar_servicio, admin_pass } = req.body;
        const aplicarServicioReal = !!aplicar_servicio;

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

        if (!(await requireMesaOperationAccess(req, res, pedido.mesa_id))) return;

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

        const subtotal = montoAPagar;
        const servicio = aplicarServicioReal ? subtotal * 0.10 : 0;
        const total = subtotal + servicio;

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
            await clearMesaResponsibilities(pedido.mesa_id);

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
                    mesa_numero: pedido.mesa_numero,
                    mensaje: `Saldo pendiente de pago - ₡${Number(total).toLocaleString('es-CR', { minimumFractionDigits: 2 })}`

                }
            });
        }

        // 🟢 SI NO ES CRÉDITO, PROCESAR COMO PAGO NORMAL
        await database.run(
            "INSERT INTO pagos (pedido_id, metodo_pago, monto, fecha) VALUES (?, ?, ?, ?)",
            [id, metodo_pago, total, new Date().toISOString()]
        );

        if (!productos_divididos || productos_divididos.length === 0) {
            await database.run("UPDATE pedidos SET estado = ? WHERE id = ?", ["pagado", id]);
            await database.run(
                "UPDATE mesas SET estado = ?, cliente_nombre = NULL, fecha_apertura = NULL, cantidad_personas = NULL, hora_estimada = NULL WHERE id = ?",
                ["libre", pedido.mesa_id]
            );
            await clearMesaResponsibilities(pedido.mesa_id);
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


