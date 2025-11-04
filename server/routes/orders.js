const express = require("express");
const database = require("../db/database");

const router = express.Router();

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

    const userId = req.session?.userId || null;

    // Calcular total
    let total = 0;
    const productosValidados = [];

    for (const item of productos) {
      const { producto_id, cantidad, presentacion_id, precio } = item;

      if (!producto_id || !cantidad || cantidad <= 0) continue;

      let precioUnitario = 0;
let es_cocina = 0;

if (typeof precio !== 'undefined') {
  // ✅ Usa el precio que ya viene del frontend
  precioUnitario = parseFloat(precio);
} else if (typeof presentacion_id !== 'undefined' && presentacion_id !== null) {
  const result = await database.get(
    `SELECT pp.precio, p.es_cocina, pp.producto_id
     FROM presentaciones_producto pp
     JOIN productos p ON p.id = pp.producto_id
     WHERE pp.id = ? AND pp.producto_id = ?`,
    [presentacion_id, producto_id]
  );
  if (!result) continue;
  precioUnitario = result.precio;
  es_cocina = result.es_cocina;
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
        presentacion_id: (typeof presentacion_id !== 'undefined') ? presentacion_id : null,
        es_cocina
      });
    }

    // Crear pedido
    const pedidoResult = await database.run(
      `INSERT INTO pedidos (mesa_id, usuario_id, fecha, estado, total, cliente_nombre)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [mesa_id, userId, new Date().toISOString(), "pendiente", total, mesa.cliente_nombre]
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

// Agregar productos a un pedido existente (respetando presentaciones y precio unitario)
router.post("/:id/products", async (req, res) => {
  try {
    const { id } = req.params;
    const { productos } = req.body;

    if (!Array.isArray(productos) || productos.length === 0) {
      return res.status(400).json({ error: "Productos son requeridos" });
    }

    // Verificar pedido pendiente
    const pedido = await database.get(
      "SELECT * FROM pedidos WHERE id = ? AND estado = ?",
      [id, "pendiente"]
    );
    if (!pedido) {
      return res
        .status(400)
        .json({ error: "Pedido no encontrado o ya está procesado" });
    }

    // Datos de mesa/zona para historial
    const zona = await database.get(
      "SELECT numero, zona, tipo_asiento FROM mesas WHERE id = ?",
      [pedido.mesa_id]
    );
    const zonaTxt = (zona && zona.zona ? zona.zona : "").toLowerCase();
    const asientoTxt = (zona && zona.tipo_asiento ? zona.tipo_asiento : "").toLowerCase();
    const nombreZona =
      zonaTxt === "bar" ? (asientoTxt === "banco" ? "banco" : "mesa") : "mesa";

    let totalAdicional = 0;
    const productosValidados = [];

    for (const item of productos) {
      const producto_id = Number(item.producto_id || 0);
      const cantidad = Number(item.cantidad || 0);
      if (!producto_id || !cantidad || cantidad <= 0) continue;

      // Producto base
      const producto = await database.get(
        "SELECT id, precio, es_cocina FROM productos WHERE id = ?",
        [producto_id]
      );
      if (!producto) {
        return res
          .status(400)
          .json({ error: `Producto con ID ${producto_id} no encontrado` });
      }

      // Determinar presentacion y precio unitario
      let presentacion_id = null;
      if (item.presentacion_id != null) presentacion_id = Number(item.presentacion_id);
      else if (item.presentacion_producto_id != null) presentacion_id = Number(item.presentacion_producto_id);

      let precioUnitario = Number(
        item.precio != null ? item.precio : item.precio_unitario
      );
      if (!Number.isFinite(precioUnitario) || precioUnitario <= 0) {
        // Intento 1: buscar por presentaciones_producto.id = presentacion_id (si viene como tal)
        if (presentacion_id != null) {
          const pres = await database.get(
            `SELECT pp.precio, p.es_cocina, pp.presentacion_id AS presentacion_base_id
             FROM presentaciones_producto pp
             JOIN productos p ON p.id = pp.producto_id
             WHERE pp.id = ? AND pp.producto_id = ?`,
            [presentacion_id, producto_id]
          );
          if (pres) {
            precioUnitario = Number(pres.precio) || 0;
            // Normalizar a id de presentacion base si aplica
            if (pres.presentacion_base_id != null) {
              presentacion_id = Number(pres.presentacion_base_id);
            }
          }
        }

        // Intento 2: buscar por presentacion_id (base) + producto
        if ((!Number.isFinite(precioUnitario) || precioUnitario <= 0) && presentacion_id != null) {
          const pres2 = await database.get(
            `SELECT pp.precio, p.es_cocina
             FROM presentaciones_producto pp
             JOIN productos p ON p.id = pp.producto_id
             WHERE pp.presentacion_id = ? AND pp.producto_id = ?`,
            [presentacion_id, producto_id]
          );
          if (pres2) {
            precioUnitario = Number(pres2.precio) || 0;
          }
        }

        // Fallback al precio del producto
        if (!Number.isFinite(precioUnitario) || precioUnitario <= 0) {
          precioUnitario = Number(producto.precio) || 0;
        }
      }

      const subtotal = precioUnitario * cantidad;
      totalAdicional += subtotal;

      productosValidados.push({
        producto_id,
        cantidad,
        presentacion_id: presentacion_id != null ? presentacion_id : null,
        precio_unitario: precioUnitario,
        precio_original: precioUnitario,
        es_cocina: !!producto.es_cocina
      });
    }

    // Persistir (consolidando por producto + presentacion + precio_unitario)
    for (const item of productosValidados) {
      const existente = await database.get(
        `SELECT id, cantidad FROM pedido_productos
         WHERE pedido_id = ?
           AND producto_id = ?
           AND COALESCE(presentacion_id, 0) = COALESCE(?, 0)
           AND precio_unitario = ?`,
        [id, item.producto_id, item.presentacion_id, item.precio_unitario]
      );

      if (existente) {
        await database.run(
          "UPDATE pedido_productos SET cantidad = cantidad + ? WHERE id = ?",
          [item.cantidad, existente.id]
        );
      } else {
        await database.run(
          `INSERT INTO pedido_productos
            (pedido_id, producto_id, cantidad, precio_unitario, precio_original, presentacion_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [id, item.producto_id, item.cantidad, item.precio_unitario, item.precio_original, item.presentacion_id]
        );
      }
    }

    // Actualizar total del pedido
    await database.run("UPDATE pedidos SET total = total + ? WHERE id = ?", [
      totalAdicional,
      id
    ]);

    // Comanda si hay productos de cocina
    const productosCocina = productosValidados.filter((i) => i.es_cocina);
    let comandaId = null;
    if (productosCocina.length > 0) {
      const comandaResult = await database.run(
        "INSERT INTO comandas (mesa_id, productos_cocina, fecha_impresion, estado) VALUES (?, ?, ?, ?)",
        [pedido.mesa_id, JSON.stringify(productosCocina), new Date().toISOString(), "pendiente"]
      );
      comandaId = comandaResult && comandaResult.id ? comandaResult.id : null;
    }

    // Historial
    const userId = req.session && req.session.userId ? req.session.userId : null;
    await database.run(
      "INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)",
      [
        `agregar_productos_${nombreZona}`,
        userId,
        `Productos agregados al pedido ${id} (${nombreZona} ${zona ? zona.numero : ""})`,
        new Date().toISOString()
      ]
    );

    return res.json({
      success: true,
      data: {
        total_adicional: totalAdicional,
        comanda_id: comandaId,
        requiere_comanda: productosCocina.length > 0
      }
    });
  } catch (error) {
    console.error("Error agregando productos al pedido:", error);
    return res
      .status(500)
      .json({ error: "Error interno del servidor" });
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
            await database.run("UPDATE mesas SET estado = ?, cliente_nombre = NULL, fecha_apertura = NULL WHERE id = ?", ["libre", pedido.mesa_id]);

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
                req.session.userNombre || 'usuario_desconocido',
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
                "UPDATE mesas SET estado = ?, cliente_nombre = NULL, fecha_apertura = NULL WHERE id = ?",
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


