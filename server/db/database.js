const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { AsyncLocalStorage } = require('async_hooks');
const { APP_VERSION } = require('../config/appInfo');
const {
    CAPABILITY_DEFINITIONS,
    CASHIER_CAPABILITIES,
    LEGACY_ROLE_BACKFILL
} = require('../security/capabilities');

const DEFAULT_DB_PATH = path.join(__dirname, '../../data/restaurant.db');
class Database {
    constructor(options = {}) {
        this.db = null;
        this.dbPath = options.dbPath
            ? path.resolve(options.dbPath)
            : (process.env.DB_PATH
                ? path.resolve(process.cwd(), process.env.DB_PATH)
                : DEFAULT_DB_PATH);
        this.transactionStorage = new AsyncLocalStorage();
        this.transactionQueue = Promise.resolve();
        this.savepointCounter = 0;
    }

    connect() {
        return new Promise((resolve, reject) => {
            const dataDir = path.dirname(this.dbPath);
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }

            this.db = new sqlite3.Database(this.dbPath, async (err) => {
                if (err) {
                    console.error('Error al conectar con la base de datos:', err);
                    reject(err);
                    return;
                }

                try {
                    await this.run('PRAGMA journal_mode = WAL');
                    await this.run('PRAGMA busy_timeout = 5000');
                    console.log(`Conectado a la base de datos SQLite: ${this.dbPath}`);
                    resolve();
                } catch (pragmaError) {
                    reject(pragmaError);
                }
            });
        });
    }

    async initializeDatabase() {
        await this.connect();

        // Durante migraciones se apagan FKs para reconstruir tablas antiguas que venían
        // referenciando mesas_old/pedidos_backup/cuentas. Se reactivan al finalizar.
        await this.run('PRAGMA foreign_keys = OFF');
        await this.createTables();
        await this.migrateSchema();
        // Los indices que dependen de columnas agregadas por migracion deben crearse
        // unicamente despues de normalizar el esquema legacy.
        await this.createIndexes();
        await this.insertInitialData();
        await this.ensureDynamicModelConsistency();
        await this.run('PRAGMA foreign_keys = ON');
    }

    async createTables() {
        const tables = [
            `CREATE TABLE IF NOT EXISTS usuarios (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nombre TEXT NOT NULL UNIQUE,
                password TEXT NOT NULL,
                tipo TEXT NOT NULL CHECK(tipo IN ('basico', 'administrador')),
                activo INTEGER NOT NULL DEFAULT 1,
                fecha_creacion TEXT NOT NULL
            )`,

            `CREATE TABLE IF NOT EXISTS zonas (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nombre TEXT NOT NULL UNIQUE,
                slug TEXT NOT NULL UNIQUE,
                icono TEXT,
                color TEXT,
                orden INTEGER NOT NULL DEFAULT 0,
                acepta_reservas INTEGER NOT NULL DEFAULT 1,
                aplica_servicio INTEGER NOT NULL DEFAULT 1,
                porcentaje_servicio REAL NOT NULL DEFAULT 10,
                visible_dashboard INTEGER NOT NULL DEFAULT 1,
                activa INTEGER NOT NULL DEFAULT 1,
                creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                actualizado_en TEXT
            )`,

            `CREATE TABLE IF NOT EXISTS tipos_puesto (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nombre TEXT NOT NULL UNIQUE,
                slug TEXT NOT NULL UNIQUE,
                icono TEXT,
                orden INTEGER NOT NULL DEFAULT 0,
                activo INTEGER NOT NULL DEFAULT 1,
                creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                actualizado_en TEXT
            )`,

            `CREATE TABLE IF NOT EXISTS roles_trabajo (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nombre TEXT NOT NULL UNIQUE,
                slug TEXT NOT NULL UNIQUE,
                descripcion TEXT,
                activo INTEGER NOT NULL DEFAULT 1,
                requiere_zona INTEGER NOT NULL DEFAULT 1,
                es_sistema INTEGER NOT NULL DEFAULT 0,
                destino_inicial TEXT NOT NULL DEFAULT 'dashboard',
                creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                actualizado_en TEXT
            )`,

            `CREATE TABLE IF NOT EXISTS capacidades (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                codigo TEXT NOT NULL UNIQUE,
                nombre TEXT NOT NULL,
                descripcion TEXT,
                categoria TEXT NOT NULL,
                activa INTEGER NOT NULL DEFAULT 1,
                creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                actualizado_en TEXT
            )`,

            `CREATE TABLE IF NOT EXISTS rol_trabajo_capacidades (
                rol_trabajo_id INTEGER NOT NULL,
                capacidad_id INTEGER NOT NULL,
                creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (rol_trabajo_id, capacidad_id),
                FOREIGN KEY (rol_trabajo_id) REFERENCES roles_trabajo (id) ON DELETE CASCADE,
                FOREIGN KEY (capacidad_id) REFERENCES capacidades (id) ON DELETE CASCADE
            )`,

            `CREATE TABLE IF NOT EXISTS rol_trabajo_zonas (
                rol_trabajo_id INTEGER NOT NULL,
                zona_id INTEGER NOT NULL,
                creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (rol_trabajo_id, zona_id),
                FOREIGN KEY (rol_trabajo_id) REFERENCES roles_trabajo (id) ON DELETE CASCADE,
                FOREIGN KEY (zona_id) REFERENCES zonas (id) ON DELETE CASCADE
            )`,


            `CREATE TABLE IF NOT EXISTS usuario_roles_trabajo (
                usuario_id INTEGER NOT NULL,
                rol_trabajo_id INTEGER NOT NULL,
                creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (usuario_id, rol_trabajo_id),
                FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE CASCADE,
                FOREIGN KEY (rol_trabajo_id) REFERENCES roles_trabajo (id) ON DELETE CASCADE
            )`,

            `CREATE TABLE IF NOT EXISTS mesas (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                numero INTEGER NOT NULL,
                capacidad INTEGER NOT NULL DEFAULT 4,
                estado TEXT NOT NULL DEFAULT 'libre' CHECK(estado IN ('libre', 'ocupada', 'reservada')),
                zona TEXT NOT NULL DEFAULT 'salon',
                tipo_asiento TEXT NOT NULL DEFAULT 'mesa',
                zona_id INTEGER,
                tipo_puesto_id INTEGER,
                nombre_visible TEXT,
                acepta_reservas_override INTEGER,
                aplica_servicio_override INTEGER,
                porcentaje_servicio_override REAL,
                activo INTEGER NOT NULL DEFAULT 1,
                cliente_nombre TEXT,
                fecha_apertura TEXT,
                cantidad_personas INTEGER,
                hora_estimada TEXT,
                UNIQUE (numero, tipo_asiento, zona)
            )`,

            `CREATE TABLE IF NOT EXISTS categorias (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nombre TEXT NOT NULL UNIQUE,
                parent_id INTEGER,
                permite_cocina INTEGER NOT NULL DEFAULT 0,
                activa INTEGER NOT NULL DEFAULT 1,
                FOREIGN KEY (parent_id) REFERENCES categorias (id) ON DELETE RESTRICT
            )`,

            `CREATE TABLE IF NOT EXISTS tipos_presentacion (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nombre TEXT NOT NULL UNIQUE,
                descripcion TEXT,
                categoria_id INTEGER NOT NULL,
                subcategoria_id INTEGER,
                activo INTEGER NOT NULL DEFAULT 1,
                creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                actualizado_en TEXT,
                FOREIGN KEY (categoria_id) REFERENCES categorias (id) ON DELETE RESTRICT,
                FOREIGN KEY (subcategoria_id) REFERENCES categorias (id) ON DELETE SET NULL
            )`,

            `CREATE TABLE IF NOT EXISTS productos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nombre TEXT NOT NULL,
                descripcion TEXT,
                precio REAL NOT NULL DEFAULT 0,
                categoria_id INTEGER NOT NULL,
                subcategoria_id INTEGER,
                es_cocina INTEGER NOT NULL DEFAULT 0,
                destino_preparacion TEXT NOT NULL DEFAULT 'ninguno',
                imagen TEXT,
                tipo_presentacion_id INTEGER,
                activo INTEGER NOT NULL DEFAULT 1,
                FOREIGN KEY (categoria_id) REFERENCES categorias (id) ON DELETE RESTRICT,
                FOREIGN KEY (tipo_presentacion_id) REFERENCES tipos_presentacion (id) ON DELETE SET NULL,
                FOREIGN KEY (subcategoria_id) REFERENCES categorias (id) ON DELETE SET NULL
            )`,

            `CREATE TABLE IF NOT EXISTS presentaciones (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nombre TEXT NOT NULL,
                tipo TEXT DEFAULT 'tamaño',
                cantidad TEXT,
                tipo_presentacion_id INTEGER,
                activo INTEGER NOT NULL DEFAULT 1,
                creado_en TEXT,
                actualizado_en TEXT,
                UNIQUE(tipo_presentacion_id, nombre, cantidad),
                FOREIGN KEY (tipo_presentacion_id) REFERENCES tipos_presentacion (id) ON DELETE SET NULL
            )`,

            `CREATE TABLE IF NOT EXISTS presentaciones_producto (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                producto_id INTEGER NOT NULL,
                presentacion_id INTEGER NOT NULL,
                precio REAL NOT NULL DEFAULT 0,
                activo INTEGER NOT NULL DEFAULT 1,
                creado_en TEXT DEFAULT CURRENT_TIMESTAMP,
                actualizado_en TEXT DEFAULT CURRENT_TIMESTAMP,
                imagen TEXT,
                UNIQUE(producto_id, presentacion_id),
                FOREIGN KEY (producto_id) REFERENCES productos (id) ON DELETE CASCADE,
                FOREIGN KEY (presentacion_id) REFERENCES presentaciones (id) ON DELETE RESTRICT
            )`,

            `CREATE TABLE IF NOT EXISTS pedidos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                mesa_id INTEGER NOT NULL,
                usuario_id INTEGER NOT NULL,
                rol_trabajo_id INTEGER,
                fecha TEXT NOT NULL,
                estado TEXT NOT NULL CHECK(estado IN ('pendiente', 'pagado', 'cancelado', 'credito')),
                total REAL NOT NULL DEFAULT 0,
                cliente_nombre TEXT,
                aplica_servicio INTEGER,
                porcentaje_servicio REAL,
                monto_servicio REAL NOT NULL DEFAULT 0,
                total_con_servicio REAL,
                numero_cuenta TEXT,
                estado_operativo TEXT NOT NULL DEFAULT 'abierta',
                estado_financiero TEXT NOT NULL DEFAULT 'sin_documentos',
                total_pagado REAL NOT NULL DEFAULT 0,
                saldo_pendiente REAL NOT NULL DEFAULT 0,
                fecha_apertura TEXT,
                fecha_conciliacion TEXT,
                fecha_cierre TEXT,
                finalizada_por_usuario_id INTEGER,
                finalizada_por_nombre_snapshot TEXT,
                observacion_cierre TEXT,
                actualizado_en TEXT,
                version INTEGER NOT NULL DEFAULT 1,
                mesa_numero_snapshot INTEGER,
                mesa_tipo_snapshot TEXT,
                zona_id_snapshot INTEGER,
                zona_nombre_snapshot TEXT,
                cliente_principal_snapshot TEXT,
                FOREIGN KEY (mesa_id) REFERENCES mesas (id) ON DELETE RESTRICT,
                FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE RESTRICT,
                FOREIGN KEY (rol_trabajo_id) REFERENCES roles_trabajo (id) ON DELETE SET NULL
            )`,

            `CREATE TABLE IF NOT EXISTS mesa_responsables (
                mesa_id INTEGER NOT NULL,
                usuario_id INTEGER NOT NULL,
                rol_trabajo_id INTEGER,
                asignado_por_usuario_id INTEGER,
                fecha_asignacion TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (mesa_id, usuario_id),
                FOREIGN KEY (mesa_id) REFERENCES mesas (id) ON DELETE CASCADE,
                FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE CASCADE,
                FOREIGN KEY (rol_trabajo_id) REFERENCES roles_trabajo (id) ON DELETE SET NULL,
                FOREIGN KEY (asignado_por_usuario_id) REFERENCES usuarios (id) ON DELETE SET NULL
            )`,

            `CREATE TABLE IF NOT EXISTS cuenta_responsables (
                pedido_id INTEGER NOT NULL,
                usuario_id INTEGER,
                rol_trabajo_id INTEGER,
                usuario_nombre_snapshot TEXT NOT NULL,
                rol_nombre_snapshot TEXT,
                es_principal INTEGER NOT NULL DEFAULT 0,
                fecha_asignacion_snapshot TEXT NOT NULL,
                PRIMARY KEY (pedido_id, usuario_nombre_snapshot, fecha_asignacion_snapshot),
                FOREIGN KEY (pedido_id) REFERENCES pedidos (id) ON DELETE CASCADE,
                FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE SET NULL,
                FOREIGN KEY (rol_trabajo_id) REFERENCES roles_trabajo (id) ON DELETE SET NULL
            )`,

            `CREATE TABLE IF NOT EXISTS pedido_productos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                pedido_id INTEGER NOT NULL,
                producto_id INTEGER NOT NULL,
                cantidad INTEGER NOT NULL,
                cantidad_asignada INTEGER NOT NULL DEFAULT 0,
                precio_unitario REAL NOT NULL,
                precio_original REAL NOT NULL,
                creado_en TEXT DEFAULT CURRENT_TIMESTAMP,
                actualizado_en TEXT,
                version INTEGER NOT NULL DEFAULT 1,
                presentacion_id INTEGER,
                producto_nombre_snapshot TEXT,
                presentacion_nombre_snapshot TEXT,
                presentacion_cantidad_snapshot TEXT,
                aplica_servicio_snapshot INTEGER NOT NULL DEFAULT 0,
                porcentaje_servicio_snapshot REAL NOT NULL DEFAULT 0,
                servicio_unitario_snapshot REAL NOT NULL DEFAULT 0,
                observacion_snapshot TEXT,
                adicionales_snapshot TEXT NOT NULL DEFAULT '[]',
                usuario_solicitante_id INTEGER,
                usuario_solicitante_nombre_snapshot TEXT,
                FOREIGN KEY (pedido_id) REFERENCES pedidos (id) ON DELETE CASCADE,
                FOREIGN KEY (producto_id) REFERENCES productos (id) ON DELETE RESTRICT,
                FOREIGN KEY (presentacion_id) REFERENCES presentaciones (id) ON DELETE SET NULL,
                FOREIGN KEY (usuario_solicitante_id) REFERENCES usuarios (id) ON DELETE SET NULL
            )`,

            `CREATE TABLE IF NOT EXISTS secuencias_documentales (
                tipo_documento TEXT PRIMARY KEY,
                prefijo TEXT NOT NULL,
                longitud INTEGER NOT NULL DEFAULT 8 CHECK(longitud > 0),
                ultimo_numero INTEGER NOT NULL DEFAULT 0 CHECK(ultimo_numero >= 0),
                version INTEGER NOT NULL DEFAULT 1,
                creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                actualizado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )`,

            `CREATE TABLE IF NOT EXISTS prefacturas (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                pedido_id INTEGER NOT NULL,
                numero_documento TEXT NOT NULL UNIQUE,
                numero_secuencia INTEGER NOT NULL UNIQUE,
                ordinal_cuenta INTEGER NOT NULL,
                tipo TEXT NOT NULL DEFAULT 'dividida' CHECK(tipo IN ('completa', 'dividida')),
                pagador_nombre TEXT NOT NULL,
                estado TEXT NOT NULL DEFAULT 'emitida' CHECK(estado IN ('emitida', 'parcial', 'pagada', 'anulada')),
                estado_impresion TEXT NOT NULL DEFAULT 'pendiente' CHECK(estado_impresion IN ('pendiente', 'impresa', 'fallida')),
                subtotal REAL NOT NULL DEFAULT 0,
                servicio REAL NOT NULL DEFAULT 0,
                total REAL NOT NULL DEFAULT 0,
                total_pagado REAL NOT NULL DEFAULT 0,
                saldo_pendiente REAL NOT NULL DEFAULT 0,
                numero_cuenta_snapshot TEXT NOT NULL,
                mesa_id_snapshot INTEGER,
                mesa_numero_snapshot INTEGER,
                mesa_tipo_snapshot TEXT,
                zona_id_snapshot INTEGER,
                zona_nombre_snapshot TEXT,
                cliente_principal_snapshot TEXT,
                responsables_snapshot TEXT NOT NULL DEFAULT '[]',
                emitida_por_usuario_id INTEGER,
                emitida_por_nombre_snapshot TEXT NOT NULL,
                anulada_por_usuario_id INTEGER,
                anulada_por_nombre_snapshot TEXT,
                clave_idempotencia TEXT UNIQUE,
                solicitud_fingerprint TEXT,
                observacion TEXT,
                fecha_emision TEXT NOT NULL,
                fecha_pago TEXT,
                fecha_anulacion TEXT,
                motivo_anulacion TEXT,
                version INTEGER NOT NULL DEFAULT 1,
                creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                actualizado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(pedido_id, ordinal_cuenta),
                FOREIGN KEY (pedido_id) REFERENCES pedidos (id) ON DELETE CASCADE,
                FOREIGN KEY (emitida_por_usuario_id) REFERENCES usuarios (id) ON DELETE SET NULL,
                FOREIGN KEY (anulada_por_usuario_id) REFERENCES usuarios (id) ON DELETE SET NULL
            )`,

            `CREATE TABLE IF NOT EXISTS prefactura_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                prefactura_id INTEGER NOT NULL,
                pedido_producto_id INTEGER NOT NULL,
                producto_id INTEGER NOT NULL,
                presentacion_id INTEGER,
                cantidad INTEGER NOT NULL CHECK(cantidad > 0),
                producto_nombre_snapshot TEXT NOT NULL,
                presentacion_nombre_snapshot TEXT,
                presentacion_cantidad_snapshot TEXT,
                precio_unitario REAL NOT NULL,
                subtotal REAL NOT NULL,
                aplica_servicio INTEGER NOT NULL DEFAULT 0,
                porcentaje_servicio REAL NOT NULL DEFAULT 0,
                servicio_unitario REAL NOT NULL DEFAULT 0,
                servicio_total REAL NOT NULL DEFAULT 0,
                total_linea REAL NOT NULL,
                creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(prefactura_id, pedido_producto_id),
                FOREIGN KEY (prefactura_id) REFERENCES prefacturas (id) ON DELETE CASCADE,
                FOREIGN KEY (pedido_producto_id) REFERENCES pedido_productos (id) ON DELETE RESTRICT,
                FOREIGN KEY (producto_id) REFERENCES productos (id) ON DELETE RESTRICT,
                FOREIGN KEY (presentacion_id) REFERENCES presentaciones (id) ON DELETE SET NULL
            )`,

            `CREATE TABLE IF NOT EXISTS historial_prefacturas (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                prefactura_id INTEGER NOT NULL,
                evento TEXT NOT NULL,
                estado_anterior TEXT,
                estado_nuevo TEXT,
                usuario_id INTEGER,
                usuario_nombre_snapshot TEXT,
                detalle TEXT,
                fecha TEXT NOT NULL,
                FOREIGN KEY (prefactura_id) REFERENCES prefacturas (id) ON DELETE CASCADE,
                FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE SET NULL
            )`,

            `CREATE TABLE IF NOT EXISTS pagos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                pedido_id INTEGER NOT NULL,
                prefactura_id INTEGER,
                credito_id INTEGER,
                numero_pago TEXT UNIQUE,
                numero_secuencia INTEGER UNIQUE,
                naturaleza TEXT NOT NULL DEFAULT 'liquidacion_venta' CHECK(naturaleza IN ('liquidacion_venta', 'cobro_credito')),
                estado TEXT NOT NULL DEFAULT 'confirmado' CHECK(estado IN ('pendiente', 'confirmado', 'anulado')),
                metodo_pago TEXT NOT NULL CHECK(metodo_pago IN ('efectivo', 'tarjeta', 'credito')),
                metodo_pago_v3 TEXT,
                monto REAL NOT NULL CHECK(monto > 0),
                monto_recibido REAL,
                vuelto REAL NOT NULL DEFAULT 0,
                subtotal REAL,
                servicio REAL NOT NULL DEFAULT 0,
                porcentaje_servicio REAL,
                aplica_servicio INTEGER,
                referencia TEXT,
                cajero_usuario_id INTEGER,
                cajero_nombre_snapshot TEXT,
                pagador_nombre_snapshot TEXT,
                fecha TEXT NOT NULL,
                fecha_anulacion TEXT,
                anulado_por_usuario_id INTEGER,
                anulado_por_nombre_snapshot TEXT,
                motivo_anulacion TEXT,
                version INTEGER NOT NULL DEFAULT 1,
                creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                actualizado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (pedido_id) REFERENCES pedidos (id) ON DELETE CASCADE,
                FOREIGN KEY (prefactura_id) REFERENCES prefacturas (id) ON DELETE RESTRICT,
                FOREIGN KEY (credito_id) REFERENCES cuentas_credito (id) ON DELETE RESTRICT,
                FOREIGN KEY (cajero_usuario_id) REFERENCES usuarios (id) ON DELETE SET NULL,
                FOREIGN KEY (anulado_por_usuario_id) REFERENCES usuarios (id) ON DELETE SET NULL
            )`,

            `CREATE TABLE IF NOT EXISTS pago_componentes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                pago_id INTEGER NOT NULL,
                tipo TEXT NOT NULL CHECK(tipo IN ('subtotal', 'servicio')),
                monto REAL NOT NULL DEFAULT 0,
                creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(pago_id, tipo),
                FOREIGN KEY (pago_id) REFERENCES pagos (id) ON DELETE CASCADE
            )`,

            `CREATE TABLE IF NOT EXISTS pago_medios (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                pago_id INTEGER NOT NULL,
                ordinal INTEGER NOT NULL,
                tipo TEXT NOT NULL CHECK(tipo IN ('efectivo', 'tarjeta', 'credito')),
                monto_aplicado REAL NOT NULL CHECK(monto_aplicado > 0),
                monto_recibido REAL NOT NULL CHECK(monto_recibido >= monto_aplicado),
                vuelto REAL NOT NULL DEFAULT 0 CHECK(vuelto >= 0),
                referencia TEXT,
                creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(pago_id, ordinal),
                UNIQUE(pago_id, tipo),
                FOREIGN KEY (pago_id) REFERENCES pagos (id) ON DELETE CASCADE
            )`,

            `CREATE TABLE IF NOT EXISTS reversos_pago (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                pago_id INTEGER NOT NULL UNIQUE,
                monto_revertido REAL NOT NULL,
                usuario_id INTEGER,
                usuario_nombre_snapshot TEXT NOT NULL,
                motivo TEXT NOT NULL,
                fecha TEXT NOT NULL,
                clave_idempotencia TEXT NOT NULL UNIQUE,
                solicitud_fingerprint TEXT NOT NULL,
                FOREIGN KEY (pago_id) REFERENCES pagos (id) ON DELETE RESTRICT,
                FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE SET NULL
            )`,

            `CREATE TABLE IF NOT EXISTS claves_idempotencia (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ambito TEXT NOT NULL,
                clave TEXT NOT NULL,
                fingerprint TEXT NOT NULL,
                recurso_tipo TEXT NOT NULL,
                recurso_id INTEGER NOT NULL,
                creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(ambito, clave)
            )`,

            `CREATE TABLE IF NOT EXISTS cuentas_credito (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                pedido_id INTEGER,
                prefactura_id INTEGER,
                pago_apertura_id INTEGER,
                numero_credito TEXT UNIQUE,
                numero_secuencia INTEGER UNIQUE,
                cliente_nombre TEXT NOT NULL,
                pagador_nombre_snapshot TEXT,
                cliente_principal_snapshot TEXT,
                numero_cuenta_snapshot TEXT,
                numero_documento_snapshot TEXT,
                mesa TEXT,
                zona_nombre_snapshot TEXT,
                responsables_snapshot TEXT NOT NULL DEFAULT '[]',
                monto_original REAL NOT NULL DEFAULT 0,
                total_abonado REAL NOT NULL DEFAULT 0,
                saldo_pendiente REAL NOT NULL DEFAULT 0,
                monto_total REAL NOT NULL,
                estado TEXT NOT NULL DEFAULT 'pendiente' CHECK(estado IN ('pendiente', 'parcial', 'saldado', 'anulado')),
                origen TEXT NOT NULL DEFAULT 'paymentservice',
                usuario_origen TEXT,
                creado_por_usuario_id INTEGER,
                creado_por_nombre_snapshot TEXT,
                autorizado_por_usuario_id INTEGER,
                autorizado_por TEXT,
                clave_idempotencia TEXT UNIQUE,
                solicitud_fingerprint TEXT,
                observacion TEXT,
                fecha TEXT NOT NULL,
                fecha_ultimo_abono TEXT,
                fecha_saldo TEXT,
                fecha_anulacion TEXT,
                motivo_anulacion TEXT,
                version INTEGER NOT NULL DEFAULT 1,
                creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                actualizado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(prefactura_id),
                FOREIGN KEY (pedido_id) REFERENCES pedidos (id) ON DELETE SET NULL,
                FOREIGN KEY (prefactura_id) REFERENCES prefacturas (id) ON DELETE RESTRICT,
                FOREIGN KEY (pago_apertura_id) REFERENCES pagos (id) ON DELETE RESTRICT,
                FOREIGN KEY (creado_por_usuario_id) REFERENCES usuarios (id) ON DELETE SET NULL,
                FOREIGN KEY (autorizado_por_usuario_id) REFERENCES usuarios (id) ON DELETE SET NULL
            )`,

            `CREATE TABLE IF NOT EXISTS creditos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cuenta_id INTEGER,
                cliente TEXT,
                total NUMERIC NOT NULL DEFAULT 0,
                estado TEXT DEFAULT 'Pendiente',
                fecha TEXT NOT NULL,
                autorizado_por TEXT,
                FOREIGN KEY (cuenta_id) REFERENCES cuentas_credito (id) ON DELETE SET NULL
            )`,

            `CREATE TABLE IF NOT EXISTS historial_creditos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                credito_id INTEGER NOT NULL,
                evento TEXT NOT NULL,
                estado_anterior TEXT,
                estado_nuevo TEXT,
                usuario_id INTEGER,
                usuario_nombre_snapshot TEXT,
                detalle TEXT,
                fecha TEXT NOT NULL,
                FOREIGN KEY (credito_id) REFERENCES cuentas_credito (id) ON DELETE CASCADE,
                FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE SET NULL
            )`,

            `CREATE TABLE IF NOT EXISTS configuracion (
                clave TEXT PRIMARY KEY,
                valor TEXT,
                version_app TEXT DEFAULT '${APP_VERSION}'
            )`,

            `CREATE TABLE IF NOT EXISTS historial_transacciones (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tipo_accion TEXT NOT NULL,
                usuario_id INTEGER,
                descripcion TEXT,
                fecha TEXT NOT NULL,
                FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE SET NULL
            )`,

            `CREATE TABLE IF NOT EXISTS respaldos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nombre_archivo TEXT NOT NULL,
                ruta TEXT NOT NULL,
                fecha_creacion TEXT NOT NULL
            )`,

            `CREATE TABLE IF NOT EXISTS comandas (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                mesa_id INTEGER,
                productos_cocina TEXT NOT NULL DEFAULT '[]',
                fecha_impresion TEXT,
                estado TEXT NOT NULL DEFAULT 'pendiente' CHECK(estado IN ('pendiente', 'impresa', 'entregada')),
                pedido_id INTEGER,
                comanda_origen_id INTEGER,
                numero_comanda TEXT UNIQUE,
                numero_secuencia INTEGER UNIQUE,
                destino TEXT NOT NULL DEFAULT 'cocina',
                estado_operativo TEXT NOT NULL DEFAULT 'pendiente',
                estado_impresion TEXT NOT NULL DEFAULT 'pendiente',
                usuario_solicitante_id INTEGER,
                usuario_solicitante_nombre_snapshot TEXT,
                numero_cuenta_snapshot TEXT,
                mesa_numero_snapshot INTEGER,
                mesa_tipo_snapshot TEXT,
                zona_id_snapshot INTEGER,
                zona_nombre_snapshot TEXT,
                solicitada_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                enviada_en TEXT,
                clave_idempotencia TEXT,
                solicitud_fingerprint TEXT,
                motivo TEXT,
                origen TEXT NOT NULL DEFAULT 'normalizada',
                version INTEGER NOT NULL DEFAULT 1,
                FOREIGN KEY (mesa_id) REFERENCES mesas (id) ON DELETE SET NULL,
                FOREIGN KEY (pedido_id) REFERENCES pedidos (id) ON DELETE SET NULL,
                FOREIGN KEY (comanda_origen_id) REFERENCES comandas (id) ON DELETE SET NULL,
                FOREIGN KEY (usuario_solicitante_id) REFERENCES usuarios (id) ON DELETE SET NULL
            )`,

            `CREATE TABLE IF NOT EXISTS comanda_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                comanda_id INTEGER NOT NULL,
                pedido_producto_id INTEGER,
                producto_id INTEGER,
                presentacion_id INTEGER,
                cantidad_delta INTEGER NOT NULL DEFAULT 0,
                cantidad_resultante_snapshot INTEGER NOT NULL DEFAULT 0,
                tipo_cambio TEXT NOT NULL CHECK(tipo_cambio IN ('envio', 'ajuste', 'anulacion', 'reenvio', 'legacy')),
                producto_nombre_snapshot TEXT NOT NULL,
                presentacion_nombre_snapshot TEXT,
                presentacion_cantidad_snapshot TEXT,
                observacion_snapshot TEXT,
                adicionales_snapshot TEXT NOT NULL DEFAULT '[]',
                usuario_solicitante_id INTEGER,
                usuario_solicitante_nombre_snapshot TEXT,
                motivo TEXT,
                creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                version INTEGER NOT NULL DEFAULT 1,
                UNIQUE(comanda_id, pedido_producto_id, tipo_cambio),
                FOREIGN KEY (comanda_id) REFERENCES comandas (id) ON DELETE CASCADE,
                FOREIGN KEY (pedido_producto_id) REFERENCES pedido_productos (id) ON DELETE SET NULL,
                FOREIGN KEY (producto_id) REFERENCES productos (id) ON DELETE SET NULL,
                FOREIGN KEY (presentacion_id) REFERENCES presentaciones (id) ON DELETE SET NULL,
                FOREIGN KEY (usuario_solicitante_id) REFERENCES usuarios (id) ON DELETE SET NULL
            )`,

            `CREATE TABLE IF NOT EXISTS historial_comandas (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                comanda_id INTEGER NOT NULL,
                evento TEXT NOT NULL,
                estado_anterior TEXT,
                estado_nuevo TEXT,
                usuario_id INTEGER,
                usuario_nombre_snapshot TEXT,
                detalle TEXT,
                fecha TEXT NOT NULL,
                FOREIGN KEY (comanda_id) REFERENCES comandas (id) ON DELETE CASCADE,
                FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE SET NULL
            )`,

            `CREATE TABLE IF NOT EXISTS solicitudes_kitchen (
                clave_idempotencia TEXT PRIMARY KEY,
                pedido_id INTEGER,
                solicitud_fingerprint TEXT NOT NULL,
                resultado_json TEXT NOT NULL,
                creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (pedido_id) REFERENCES pedidos (id) ON DELETE SET NULL
            )`,

            `CREATE TABLE IF NOT EXISTS pagos_creditos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                credito_id INTEGER NOT NULL,
                cliente_nombre TEXT NOT NULL,
                monto_pagado REAL NOT NULL,
                monto_original REAL NOT NULL,
                es_pago_completo INTEGER NOT NULL DEFAULT 0,
                metodo_pago TEXT NOT NULL,
                fecha_pago TEXT NOT NULL,
                usuario_id INTEGER,
                FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE SET NULL
            )`
        ];

        for (const sql of tables) {
            await this.run(sql);
        }

        console.log('Tablas base verificadas correctamente');
    }

    async createIndexes() {
        const indexes = [
            'CREATE INDEX IF NOT EXISTS idx_pedidos_estado ON pedidos(estado)',
            'CREATE INDEX IF NOT EXISTS idx_pedidos_fecha ON pedidos(fecha)',
            'CREATE INDEX IF NOT EXISTS idx_pedidos_mesa ON pedidos(mesa_id)',
            'CREATE INDEX IF NOT EXISTS idx_pedido_productos_pedido ON pedido_productos(pedido_id)',
            'CREATE INDEX IF NOT EXISTS idx_prefacturas_pedido ON prefacturas(pedido_id)',
            'CREATE INDEX IF NOT EXISTS idx_prefacturas_estado ON prefacturas(estado)',
            'CREATE INDEX IF NOT EXISTS idx_prefacturas_impresion ON prefacturas(estado_impresion)',
            'CREATE INDEX IF NOT EXISTS idx_prefactura_items_prefactura ON prefactura_items(prefactura_id)',
            'CREATE INDEX IF NOT EXISTS idx_prefactura_items_linea ON prefactura_items(pedido_producto_id)',
            'CREATE INDEX IF NOT EXISTS idx_historial_prefacturas_documento ON historial_prefacturas(prefactura_id)',
            'CREATE INDEX IF NOT EXISTS idx_pagos_pedido ON pagos(pedido_id)',
            'CREATE INDEX IF NOT EXISTS idx_cuentas_credito_pedido ON cuentas_credito(pedido_id)',
            'CREATE INDEX IF NOT EXISTS idx_historial_creditos_credito ON historial_creditos(credito_id)',
            'CREATE INDEX IF NOT EXISTS idx_mesas_estado ON mesas(estado)',
            'CREATE INDEX IF NOT EXISTS idx_zonas_slug ON zonas(slug)',
            'CREATE INDEX IF NOT EXISTS idx_tipos_puesto_slug ON tipos_puesto(slug)',
            'CREATE INDEX IF NOT EXISTS idx_roles_trabajo_slug ON roles_trabajo(slug)',
            'CREATE INDEX IF NOT EXISTS idx_capacidades_codigo ON capacidades(codigo)',
            'CREATE INDEX IF NOT EXISTS idx_rol_capacidades_capacidad ON rol_trabajo_capacidades(capacidad_id)',
            'CREATE INDEX IF NOT EXISTS idx_rol_trabajo_zonas_zona ON rol_trabajo_zonas(zona_id)',
            'CREATE INDEX IF NOT EXISTS idx_usuario_roles_trabajo_usuario ON usuario_roles_trabajo(usuario_id)',
            'CREATE INDEX IF NOT EXISTS idx_usuario_roles_trabajo_rol ON usuario_roles_trabajo(rol_trabajo_id)',
            'CREATE INDEX IF NOT EXISTS idx_mesa_responsables_mesa ON mesa_responsables(mesa_id)',
            'CREATE INDEX IF NOT EXISTS idx_mesa_responsables_usuario ON mesa_responsables(usuario_id)',
            'CREATE INDEX IF NOT EXISTS idx_mesa_responsables_rol ON mesa_responsables(rol_trabajo_id)',
            'CREATE INDEX IF NOT EXISTS idx_cuentas_credito_fecha ON cuentas_credito(fecha)',
            'CREATE INDEX IF NOT EXISTS idx_historial_fecha ON historial_transacciones(fecha)',
            'CREATE INDEX IF NOT EXISTS idx_comandas_pedido ON comandas(pedido_id)',
            'CREATE INDEX IF NOT EXISTS idx_comandas_operacion ON comandas(estado_operativo, destino, solicitada_en)',
            'CREATE UNIQUE INDEX IF NOT EXISTS idx_comandas_idempotencia_destino ON comandas(clave_idempotencia, destino) WHERE clave_idempotencia IS NOT NULL',
            'CREATE INDEX IF NOT EXISTS idx_comanda_items_comanda ON comanda_items(comanda_id)',
            'CREATE INDEX IF NOT EXISTS idx_comanda_items_linea ON comanda_items(pedido_producto_id)',
            'CREATE INDEX IF NOT EXISTS idx_historial_comandas_comanda ON historial_comandas(comanda_id)'
        ];

        for (const sql of indexes) {
            await this.run(sql);
        }
    }

    async createDynamicModelIndexes() {
        const indexes = [
            'CREATE INDEX IF NOT EXISTS idx_mesas_zona_id ON mesas(zona_id)',
            'CREATE INDEX IF NOT EXISTS idx_mesas_tipo_puesto_id ON mesas(tipo_puesto_id)',
            'CREATE INDEX IF NOT EXISTS idx_rol_trabajo_zonas_rol ON rol_trabajo_zonas(rol_trabajo_id)'
        ];

        for (const sql of indexes) {
            await this.run(sql);
        }
    }

    async migrateSchema() {
        await this.ensureColumn('usuarios', 'activo', "INTEGER NOT NULL DEFAULT 1");
        await this.ensureColumn('usuarios', 'fecha_creacion', "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP");

        await this.ensureColumn('roles_trabajo', 'requiere_zona', 'INTEGER NOT NULL DEFAULT 1');
        await this.ensureColumn('roles_trabajo', 'es_sistema', 'INTEGER NOT NULL DEFAULT 0');
        await this.ensureColumn('roles_trabajo', 'destino_inicial', "TEXT NOT NULL DEFAULT 'dashboard'");

        await this.ensureColumn('mesas', 'zona', "TEXT NOT NULL DEFAULT 'salon'");
        await this.ensureColumn('mesas', 'tipo_asiento', "TEXT NOT NULL DEFAULT 'mesa'");
        await this.ensureColumn('mesas', 'zona_id', 'INTEGER');
        await this.ensureColumn('mesas', 'tipo_puesto_id', 'INTEGER');
        await this.ensureColumn('mesas', 'nombre_visible', 'TEXT');
        await this.ensureColumn('mesas', 'acepta_reservas_override', 'INTEGER');
        await this.ensureColumn('mesas', 'aplica_servicio_override', 'INTEGER');
        await this.ensureColumn('mesas', 'porcentaje_servicio_override', 'REAL');
        await this.ensureColumn('mesas', 'activo', 'INTEGER NOT NULL DEFAULT 1');
        await this.ensureColumn('mesas', 'cliente_nombre', 'TEXT');
        await this.ensureColumn('mesas', 'fecha_apertura', 'TEXT');
        await this.ensureColumn('mesas', 'cantidad_personas', 'INTEGER');
        await this.ensureColumn('mesas', 'hora_estimada', 'TEXT');
        await this.normalizeLegacyTableColumns();
        await this.createDynamicModelIndexes();

        await this.ensureColumn('categorias', 'activa', 'INTEGER NOT NULL DEFAULT 1');
        await this.ensureColumn('productos', 'imagen', 'TEXT');
        await this.ensureColumn('productos', 'tipo_presentacion_id', 'INTEGER');
        await this.ensurePreparationDestinationColumn();
        await this.ensureColumn('productos', 'activo', 'INTEGER NOT NULL DEFAULT 1');
        await this.ensureColumn('presentaciones', 'tipo', "TEXT DEFAULT 'tamaño'");
        await this.ensureColumn('presentaciones', 'cantidad', 'TEXT');
        await this.ensureColumn('presentaciones', 'tipo_presentacion_id', 'INTEGER');
        await this.ensureColumn('presentaciones', 'activo', 'INTEGER NOT NULL DEFAULT 1');
        await this.ensureColumn('presentaciones', 'creado_en', 'TEXT');
        await this.ensureColumn('presentaciones', 'actualizado_en', 'TEXT');
        await this.rebuildPresentacionesForPresentationTypes();
        await this.ensureColumn('presentaciones_producto', 'activo', 'INTEGER NOT NULL DEFAULT 1');
        await this.ensureColumn('presentaciones_producto', 'creado_en', 'TEXT DEFAULT CURRENT_TIMESTAMP');
        await this.ensureColumn('presentaciones_producto', 'actualizado_en', 'TEXT DEFAULT CURRENT_TIMESTAMP');
        await this.ensureColumn('presentaciones_producto', 'imagen', 'TEXT');
        await this.run(`UPDATE categorias SET activa = 1 WHERE activa IS NULL`);
        await this.run(`UPDATE productos SET activo = 1 WHERE activo IS NULL`);
        await this.run(`UPDATE presentaciones SET activo = 1 WHERE activo IS NULL`);
        await this.run(`UPDATE presentaciones_producto SET activo = 1 WHERE activo IS NULL`);
        await this.run('CREATE INDEX IF NOT EXISTS idx_tipos_presentacion_categoria ON tipos_presentacion(categoria_id, subcategoria_id)');
        await this.run('CREATE INDEX IF NOT EXISTS idx_presentaciones_tipo_presentacion ON presentaciones(tipo_presentacion_id)');
        await this.run('CREATE INDEX IF NOT EXISTS idx_productos_tipo_presentacion ON productos(tipo_presentacion_id)');

        await this.ensureColumn('pedidos', 'cliente_nombre', 'TEXT');
        await this.ensureColumn('pedidos', 'rol_trabajo_id', 'INTEGER');
        await this.run('CREATE INDEX IF NOT EXISTS idx_pedidos_rol_trabajo ON pedidos(rol_trabajo_id)');
        await this.ensureColumn('pedidos', 'aplica_servicio', 'INTEGER');
        await this.ensureColumn('pedidos', 'porcentaje_servicio', 'REAL');
        await this.ensureColumn('pedidos', 'monto_servicio', 'REAL NOT NULL DEFAULT 0');
        await this.ensureColumn('pedidos', 'total_con_servicio', 'REAL');
        await this.ensureGlobalAccountColumns();
        await this.ensureColumn('pagos', 'subtotal', 'REAL');
        await this.ensureColumn('pagos', 'servicio', 'REAL NOT NULL DEFAULT 0');
        await this.ensureColumn('pagos', 'porcentaje_servicio', 'REAL');
        await this.ensureColumn('pagos', 'aplica_servicio', 'INTEGER');
        await this.backfillOrderServiceTotals();
        await this.ensureConsumptionLineColumns();
        await this.ensureKitchenSchema();
        await this.ensureColumn('cuentas_credito', 'pedido_id', 'INTEGER');
        await this.ensureColumn('cuentas_credito', 'usuario_origen', 'TEXT');
        await this.ensureColumn('cuentas_credito', 'autorizado_por', 'TEXT');
        await this.ensureColumn('cuentas_credito', 'mesa', 'TEXT');
        await this.ensureColumn('configuracion', 'version_app', `TEXT DEFAULT '${APP_VERSION}'`);

        await this.rebuildLegacyForeignKeys();
        // Algunas bases antiguas reconstruyen pedidos durante la migración. Se vuelven a
        // asegurar las columnas v3 después de esa reconstrucción antes del backfill.
        await this.ensureGlobalAccountColumns();
        await this.ensureConsumptionLineColumns();
        await this.ensureKitchenSchema();
        await this.ensurePreinvoiceSchema();
        await this.ensurePaymentSchema();
        await this.ensureCreditSchema();
        await this.migrateGlobalAccounts();
        await this.migrateConsumptionLines();
        await this.migrateKitchenLegacy();
        await this.cleanupOrphanRows();
        console.log('Migraciones de esquema aplicadas/verificadas');
    }

    async ensurePreparationDestinationColumn() {
        await this.ensureColumn('productos', 'destino_preparacion', "TEXT NOT NULL DEFAULT 'ninguno'");
        await this.run(`
            UPDATE productos
            SET destino_preparacion = CASE
                WHEN COALESCE(es_cocina, 0) = 1 THEN 'cocina'
                ELSE 'ninguno'
            END
            WHERE destino_preparacion IS NULL
               OR TRIM(destino_preparacion) = ''
               OR destino_preparacion NOT IN ('ninguno', 'cocina', 'bar')
               OR (destino_preparacion = 'ninguno' AND COALESCE(es_cocina, 0) = 1)
        `);
    }

    async ensureConsumptionLineColumns() {
        await this.ensureColumn('pedido_productos', 'creado_en', 'TEXT DEFAULT CURRENT_TIMESTAMP');
        await this.ensureColumn('pedido_productos', 'presentacion_id', 'INTEGER');
        await this.ensureColumn('pedido_productos', 'cantidad_asignada', 'INTEGER NOT NULL DEFAULT 0');
        await this.ensureColumn('pedido_productos', 'actualizado_en', 'TEXT');
        await this.ensureColumn('pedido_productos', 'version', 'INTEGER NOT NULL DEFAULT 1');
        await this.ensureColumn('pedido_productos', 'producto_nombre_snapshot', 'TEXT');
        await this.ensureColumn('pedido_productos', 'presentacion_nombre_snapshot', 'TEXT');
        await this.ensureColumn('pedido_productos', 'presentacion_cantidad_snapshot', 'TEXT');
        await this.ensureColumn('pedido_productos', 'aplica_servicio_snapshot', 'INTEGER NOT NULL DEFAULT 0');
        await this.ensureColumn('pedido_productos', 'porcentaje_servicio_snapshot', 'REAL NOT NULL DEFAULT 0');
        await this.ensureColumn('pedido_productos', 'servicio_unitario_snapshot', 'REAL NOT NULL DEFAULT 0');
        await this.ensureColumn('pedido_productos', 'observacion_snapshot', 'TEXT');
        await this.ensureColumn('pedido_productos', 'adicionales_snapshot', "TEXT NOT NULL DEFAULT '[]'");
        await this.ensureColumn('pedido_productos', 'usuario_solicitante_id', 'INTEGER');
        await this.ensureColumn('pedido_productos', 'usuario_solicitante_nombre_snapshot', 'TEXT');
    }

    async migrateConsumptionLines() {
        if (!await this.tableExists('pedido_productos')) return;

        // La cantidad asignada es un contador transaccional que en v3.1.2 será
        // actualizado por prefacturas no anuladas. Nunca puede ser negativa ni
        // superar la cantidad consumida de la línea.
        await this.run(`
            UPDATE pedido_productos
            SET cantidad_asignada = CASE
                WHEN cantidad_asignada IS NULL OR cantidad_asignada < 0 THEN 0
                WHEN cantidad_asignada > cantidad THEN cantidad
                ELSE cantidad_asignada
            END,
            version = CASE WHEN version IS NULL OR version < 1 THEN 1 ELSE version END
        `);

        // Solo las líneas antiguas (sin timestamp de actualización) reciben el
        // snapshot inicial. Reinicios posteriores no reescriben su historia.
        await this.run(`
            UPDATE pedido_productos
            SET producto_nombre_snapshot = COALESCE(
                    NULLIF(producto_nombre_snapshot, ''),
                    (SELECT p.nombre FROM productos p WHERE p.id = pedido_productos.producto_id),
                    'Producto'
                ),
                presentacion_nombre_snapshot = COALESCE(
                    NULLIF(presentacion_nombre_snapshot, ''),
                    (SELECT pr.nombre FROM presentaciones pr WHERE pr.id = pedido_productos.presentacion_id)
                ),
                presentacion_cantidad_snapshot = COALESCE(
                    NULLIF(presentacion_cantidad_snapshot, ''),
                    (SELECT pr.cantidad FROM presentaciones pr WHERE pr.id = pedido_productos.presentacion_id)
                ),
                aplica_servicio_snapshot = COALESCE(
                    (SELECT CASE WHEN p.aplica_servicio = 1 THEN 1 ELSE 0 END
                     FROM pedidos p WHERE p.id = pedido_productos.pedido_id),
                    0
                ),
                porcentaje_servicio_snapshot = COALESCE(
                    (SELECT CASE WHEN p.aplica_servicio = 1 THEN COALESCE(p.porcentaje_servicio, 0) ELSE 0 END
                     FROM pedidos p WHERE p.id = pedido_productos.pedido_id),
                    0
                ),
                servicio_unitario_snapshot = ROUND(
                    precio_unitario * COALESCE(
                        (SELECT CASE WHEN p.aplica_servicio = 1 THEN COALESCE(p.porcentaje_servicio, 0) ELSE 0 END
                         FROM pedidos p WHERE p.id = pedido_productos.pedido_id),
                        0
                    ) / 100.0,
                    2
                ),
                actualizado_en = COALESCE(creado_en, CURRENT_TIMESTAMP)
            WHERE actualizado_en IS NULL
               OR producto_nombre_snapshot IS NULL
               OR TRIM(producto_nombre_snapshot) = ''
        `);

        await this.run('CREATE INDEX IF NOT EXISTS idx_pedido_productos_disponibles ON pedido_productos(pedido_id, cantidad, cantidad_asignada)');

        if (await this.tableExists('configuracion')) {
            await this.run(`
                INSERT OR REPLACE INTO configuracion (clave, valor, version_app)
                VALUES ('v3_consumption_line_backfill_done', ?, ?)
            `, [new Date().toISOString(), APP_VERSION]);
        }
    }

    async ensureKitchenSchema() {
        await this.run(`CREATE TABLE IF NOT EXISTS comanda_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            comanda_id INTEGER NOT NULL,
            pedido_producto_id INTEGER,
            producto_id INTEGER,
            presentacion_id INTEGER,
            cantidad_delta INTEGER NOT NULL DEFAULT 0,
            cantidad_resultante_snapshot INTEGER NOT NULL DEFAULT 0,
            tipo_cambio TEXT NOT NULL CHECK(tipo_cambio IN ('envio', 'ajuste', 'anulacion', 'reenvio', 'legacy')),
            producto_nombre_snapshot TEXT NOT NULL,
            presentacion_nombre_snapshot TEXT,
            presentacion_cantidad_snapshot TEXT,
            observacion_snapshot TEXT,
            adicionales_snapshot TEXT NOT NULL DEFAULT '[]',
            usuario_solicitante_id INTEGER,
            usuario_solicitante_nombre_snapshot TEXT,
            motivo TEXT,
            creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            version INTEGER NOT NULL DEFAULT 1,
            UNIQUE(comanda_id, pedido_producto_id, tipo_cambio),
            FOREIGN KEY (comanda_id) REFERENCES comandas (id) ON DELETE CASCADE,
            FOREIGN KEY (pedido_producto_id) REFERENCES pedido_productos (id) ON DELETE SET NULL,
            FOREIGN KEY (producto_id) REFERENCES productos (id) ON DELETE SET NULL,
            FOREIGN KEY (presentacion_id) REFERENCES presentaciones (id) ON DELETE SET NULL,
            FOREIGN KEY (usuario_solicitante_id) REFERENCES usuarios (id) ON DELETE SET NULL
        )`);

        await this.run(`CREATE TABLE IF NOT EXISTS historial_comandas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            comanda_id INTEGER NOT NULL,
            evento TEXT NOT NULL,
            estado_anterior TEXT,
            estado_nuevo TEXT,
            usuario_id INTEGER,
            usuario_nombre_snapshot TEXT,
            detalle TEXT,
            fecha TEXT NOT NULL,
            FOREIGN KEY (comanda_id) REFERENCES comandas (id) ON DELETE CASCADE,
            FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE SET NULL
        )`);

        await this.run(`CREATE TABLE IF NOT EXISTS solicitudes_kitchen (
            clave_idempotencia TEXT PRIMARY KEY,
            pedido_id INTEGER,
            solicitud_fingerprint TEXT NOT NULL,
            resultado_json TEXT NOT NULL,
            creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (pedido_id) REFERENCES pedidos (id) ON DELETE SET NULL
        )`);

        const columns = [
            ['pedido_id', 'INTEGER'],
            ['comanda_origen_id', 'INTEGER'],
            ['numero_comanda', 'TEXT'],
            ['numero_secuencia', 'INTEGER'],
            ['destino', "TEXT NOT NULL DEFAULT 'cocina'"],
            ['estado_operativo', "TEXT NOT NULL DEFAULT 'pendiente'"],
            ['estado_impresion', "TEXT NOT NULL DEFAULT 'pendiente'"],
            ['usuario_solicitante_id', 'INTEGER'],
            ['usuario_solicitante_nombre_snapshot', 'TEXT'],
            ['numero_cuenta_snapshot', 'TEXT'],
            ['mesa_numero_snapshot', 'INTEGER'],
            ['mesa_tipo_snapshot', 'TEXT'],
            ['zona_id_snapshot', 'INTEGER'],
            ['zona_nombre_snapshot', 'TEXT'],
            ['solicitada_en', 'TEXT'],
            ['enviada_en', 'TEXT'],
            ['clave_idempotencia', 'TEXT'],
            ['solicitud_fingerprint', 'TEXT'],
            ['motivo', 'TEXT'],
            ['origen', "TEXT NOT NULL DEFAULT 'legacy'"],
            ['version', 'INTEGER NOT NULL DEFAULT 1']
        ];
        for (const [column, definition] of columns) {
            await this.ensureColumn('comandas', column, definition);
        }

        await this.run('CREATE INDEX IF NOT EXISTS idx_comandas_pedido ON comandas(pedido_id)');
        await this.run('CREATE INDEX IF NOT EXISTS idx_comandas_operacion ON comandas(estado_operativo, destino, solicitada_en)');
        await this.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_comandas_numero ON comandas(numero_comanda) WHERE numero_comanda IS NOT NULL');
        await this.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_comandas_secuencia ON comandas(numero_secuencia) WHERE numero_secuencia IS NOT NULL');
        await this.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_comandas_idempotencia_destino ON comandas(clave_idempotencia, destino) WHERE clave_idempotencia IS NOT NULL');
        await this.run('CREATE INDEX IF NOT EXISTS idx_comanda_items_comanda ON comanda_items(comanda_id)');
        await this.run('CREATE INDEX IF NOT EXISTS idx_comanda_items_linea ON comanda_items(pedido_producto_id)');
        await this.run('CREATE INDEX IF NOT EXISTS idx_historial_comandas_comanda ON historial_comandas(comanda_id)');
    }

    async migrateKitchenLegacy() {
        if (!await this.tableExists('comandas')) return;

        await this.run(`
            UPDATE comandas
            SET destino = COALESCE(NULLIF(TRIM(destino), ''), 'cocina'),
                estado_operativo = CASE
                    WHEN COALESCE(NULLIF(TRIM(origen), ''), 'legacy') = 'legacy'
                         AND estado = 'entregada' THEN 'entregada'
                    WHEN COALESCE(NULLIF(TRIM(origen), ''), 'legacy') = 'legacy'
                         AND estado = 'impresa' THEN 'enviada'
                    ELSE COALESCE(NULLIF(TRIM(estado_operativo), ''), 'pendiente')
                END,
                estado_impresion = CASE
                    WHEN COALESCE(NULLIF(TRIM(origen), ''), 'legacy') = 'legacy'
                         AND estado IN ('impresa', 'entregada') THEN 'impresa'
                    ELSE COALESCE(NULLIF(TRIM(estado_impresion), ''), 'pendiente')
                END,
                solicitada_en = COALESCE(solicitada_en, fecha_impresion, CURRENT_TIMESTAMP),
                origen = COALESCE(NULLIF(TRIM(origen), ''), 'legacy'),
                version = COALESCE(version, 1)
        `);

        if (await this.tableExists('configuracion')) {
            await this.run(`
                INSERT OR REPLACE INTO configuracion (clave, valor, version_app)
                VALUES ('v3_3_kitchen_schema_ready', ?, ?)
            `, [new Date().toISOString(), APP_VERSION]);
        }
    }

    async ensurePreinvoiceSchema() {
        await this.run(`CREATE TABLE IF NOT EXISTS secuencias_documentales (
            tipo_documento TEXT PRIMARY KEY,
            prefijo TEXT NOT NULL,
            longitud INTEGER NOT NULL DEFAULT 8 CHECK(longitud > 0),
            ultimo_numero INTEGER NOT NULL DEFAULT 0 CHECK(ultimo_numero >= 0),
            version INTEGER NOT NULL DEFAULT 1,
            creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            actualizado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`);

        await this.run(`CREATE TABLE IF NOT EXISTS prefacturas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pedido_id INTEGER NOT NULL,
            numero_documento TEXT NOT NULL UNIQUE,
            numero_secuencia INTEGER NOT NULL UNIQUE,
            ordinal_cuenta INTEGER NOT NULL,
            tipo TEXT NOT NULL DEFAULT 'dividida' CHECK(tipo IN ('completa', 'dividida')),
            pagador_nombre TEXT NOT NULL,
            estado TEXT NOT NULL DEFAULT 'emitida' CHECK(estado IN ('emitida', 'parcial', 'pagada', 'anulada')),
            estado_impresion TEXT NOT NULL DEFAULT 'pendiente' CHECK(estado_impresion IN ('pendiente', 'impresa', 'fallida')),
            subtotal REAL NOT NULL DEFAULT 0,
            servicio REAL NOT NULL DEFAULT 0,
            total REAL NOT NULL DEFAULT 0,
            total_pagado REAL NOT NULL DEFAULT 0,
            saldo_pendiente REAL NOT NULL DEFAULT 0,
            numero_cuenta_snapshot TEXT NOT NULL,
            mesa_id_snapshot INTEGER,
            mesa_numero_snapshot INTEGER,
            mesa_tipo_snapshot TEXT,
            zona_id_snapshot INTEGER,
            zona_nombre_snapshot TEXT,
            cliente_principal_snapshot TEXT,
            responsables_snapshot TEXT NOT NULL DEFAULT '[]',
            emitida_por_usuario_id INTEGER,
            emitida_por_nombre_snapshot TEXT NOT NULL,
            anulada_por_usuario_id INTEGER,
            anulada_por_nombre_snapshot TEXT,
            clave_idempotencia TEXT UNIQUE,
            solicitud_fingerprint TEXT,
            observacion TEXT,
            fecha_emision TEXT NOT NULL,
            fecha_pago TEXT,
            fecha_anulacion TEXT,
            motivo_anulacion TEXT,
            version INTEGER NOT NULL DEFAULT 1,
            creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            actualizado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(pedido_id, ordinal_cuenta),
            FOREIGN KEY (pedido_id) REFERENCES pedidos (id) ON DELETE CASCADE,
            FOREIGN KEY (emitida_por_usuario_id) REFERENCES usuarios (id) ON DELETE SET NULL,
            FOREIGN KEY (anulada_por_usuario_id) REFERENCES usuarios (id) ON DELETE SET NULL
        )`);

        await this.run(`CREATE TABLE IF NOT EXISTS prefactura_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            prefactura_id INTEGER NOT NULL,
            pedido_producto_id INTEGER NOT NULL,
            producto_id INTEGER NOT NULL,
            presentacion_id INTEGER,
            cantidad INTEGER NOT NULL CHECK(cantidad > 0),
            producto_nombre_snapshot TEXT NOT NULL,
            presentacion_nombre_snapshot TEXT,
            presentacion_cantidad_snapshot TEXT,
            precio_unitario REAL NOT NULL,
            subtotal REAL NOT NULL,
            aplica_servicio INTEGER NOT NULL DEFAULT 0,
            porcentaje_servicio REAL NOT NULL DEFAULT 0,
            servicio_unitario REAL NOT NULL DEFAULT 0,
            servicio_total REAL NOT NULL DEFAULT 0,
            total_linea REAL NOT NULL,
            creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(prefactura_id, pedido_producto_id),
            FOREIGN KEY (prefactura_id) REFERENCES prefacturas (id) ON DELETE CASCADE,
            FOREIGN KEY (pedido_producto_id) REFERENCES pedido_productos (id) ON DELETE RESTRICT,
            FOREIGN KEY (producto_id) REFERENCES productos (id) ON DELETE RESTRICT,
            FOREIGN KEY (presentacion_id) REFERENCES presentaciones (id) ON DELETE SET NULL
        )`);

        await this.run(`CREATE TABLE IF NOT EXISTS historial_prefacturas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            prefactura_id INTEGER NOT NULL,
            evento TEXT NOT NULL,
            estado_anterior TEXT,
            estado_nuevo TEXT,
            usuario_id INTEGER,
            usuario_nombre_snapshot TEXT,
            detalle TEXT,
            fecha TEXT NOT NULL,
            FOREIGN KEY (prefactura_id) REFERENCES prefacturas (id) ON DELETE CASCADE,
            FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE SET NULL
        )`);

        await this.run(`
            INSERT OR IGNORE INTO secuencias_documentales (
                tipo_documento, prefijo, longitud, ultimo_numero,
                version, creado_en, actualizado_en
            ) VALUES ('prefactura', 'PF', 8, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `);

        await this.run('CREATE INDEX IF NOT EXISTS idx_prefacturas_pedido ON prefacturas(pedido_id)');
        await this.run('CREATE INDEX IF NOT EXISTS idx_prefacturas_estado ON prefacturas(estado)');
        await this.run('CREATE INDEX IF NOT EXISTS idx_prefacturas_impresion ON prefacturas(estado_impresion)');
        await this.run('CREATE INDEX IF NOT EXISTS idx_prefactura_items_prefactura ON prefactura_items(prefactura_id)');
        await this.run('CREATE INDEX IF NOT EXISTS idx_prefactura_items_linea ON prefactura_items(pedido_producto_id)');
        await this.run('CREATE INDEX IF NOT EXISTS idx_historial_prefacturas_documento ON historial_prefacturas(prefactura_id)');

        if (await this.tableExists('configuracion')) {
            await this.run(`
                INSERT OR REPLACE INTO configuracion (clave, valor, version_app)
                VALUES ('v3_preinvoice_schema_ready', ?, ?)
            `, [new Date().toISOString(), APP_VERSION]);
        }
    }

    async ensurePaymentSchema() {
        await this.ensureColumn('pagos', 'prefactura_id', 'INTEGER');
        await this.ensureColumn('pagos', 'credito_id', 'INTEGER');
        await this.ensureColumn('pagos', 'naturaleza', "TEXT NOT NULL DEFAULT 'liquidacion_venta'");
        await this.ensureColumn('pagos', 'numero_pago', 'TEXT');
        await this.ensureColumn('pagos', 'numero_secuencia', 'INTEGER');
        await this.ensureColumn('pagos', 'estado', "TEXT NOT NULL DEFAULT 'confirmado'");
        await this.ensureColumn('pagos', 'metodo_pago_v3', 'TEXT');
        await this.ensureColumn('pagos', 'monto_recibido', 'REAL');
        await this.ensureColumn('pagos', 'vuelto', 'REAL NOT NULL DEFAULT 0');
        await this.ensureColumn('pagos', 'referencia', 'TEXT');
        await this.ensureColumn('pagos', 'cajero_usuario_id', 'INTEGER');
        await this.ensureColumn('pagos', 'cajero_nombre_snapshot', 'TEXT');
        await this.ensureColumn('pagos', 'pagador_nombre_snapshot', 'TEXT');
        await this.ensureColumn('pagos', 'fecha_anulacion', 'TEXT');
        await this.ensureColumn('pagos', 'anulado_por_usuario_id', 'INTEGER');
        await this.ensureColumn('pagos', 'anulado_por_nombre_snapshot', 'TEXT');
        await this.ensureColumn('pagos', 'motivo_anulacion', 'TEXT');
        await this.ensureColumn('pagos', 'version', 'INTEGER NOT NULL DEFAULT 1');
        await this.ensureColumn('pagos', 'creado_en', 'TEXT');
        await this.ensureColumn('pagos', 'actualizado_en', 'TEXT');

        await this.run(`CREATE TABLE IF NOT EXISTS pago_componentes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pago_id INTEGER NOT NULL,
            tipo TEXT NOT NULL CHECK(tipo IN ('subtotal', 'servicio')),
            monto REAL NOT NULL DEFAULT 0,
            creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(pago_id, tipo),
            FOREIGN KEY (pago_id) REFERENCES pagos (id) ON DELETE CASCADE
        )`);
        await this.run(`CREATE TABLE IF NOT EXISTS pago_medios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pago_id INTEGER NOT NULL,
            ordinal INTEGER NOT NULL,
            tipo TEXT NOT NULL CHECK(tipo IN ('efectivo', 'tarjeta', 'credito')),
            monto_aplicado REAL NOT NULL CHECK(monto_aplicado > 0),
            monto_recibido REAL NOT NULL CHECK(monto_recibido >= monto_aplicado),
            vuelto REAL NOT NULL DEFAULT 0 CHECK(vuelto >= 0),
            referencia TEXT,
            creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(pago_id, ordinal),
            UNIQUE(pago_id, tipo),
            FOREIGN KEY (pago_id) REFERENCES pagos (id) ON DELETE CASCADE
        )`);
        await this.run(`CREATE TABLE IF NOT EXISTS reversos_pago (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pago_id INTEGER NOT NULL UNIQUE,
            monto_revertido REAL NOT NULL,
            usuario_id INTEGER,
            usuario_nombre_snapshot TEXT NOT NULL,
            motivo TEXT NOT NULL,
            fecha TEXT NOT NULL,
            clave_idempotencia TEXT NOT NULL UNIQUE,
            solicitud_fingerprint TEXT NOT NULL,
            FOREIGN KEY (pago_id) REFERENCES pagos (id) ON DELETE RESTRICT,
            FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE SET NULL
        )`);
        await this.run(`CREATE TABLE IF NOT EXISTS claves_idempotencia (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ambito TEXT NOT NULL,
            clave TEXT NOT NULL,
            fingerprint TEXT NOT NULL,
            recurso_tipo TEXT NOT NULL,
            recurso_id INTEGER NOT NULL,
            creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(ambito, clave)
        )`);

        await this.run(`
            INSERT OR IGNORE INTO secuencias_documentales (
                tipo_documento, prefijo, longitud, ultimo_numero,
                version, creado_en, actualizado_en
            ) VALUES ('pago', 'PG', 8, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `);

        await this.run(`
            UPDATE pagos
            SET estado = CASE
                    WHEN estado IS NULL OR estado NOT IN ('pendiente', 'confirmado', 'anulado') THEN 'confirmado'
                    ELSE estado
                END,
                naturaleza = CASE
                    WHEN naturaleza IN ('liquidacion_venta', 'cobro_credito') THEN naturaleza
                    ELSE 'liquidacion_venta'
                END,
                metodo_pago_v3 = COALESCE(NULLIF(metodo_pago_v3, ''), metodo_pago),
                monto_recibido = COALESCE(monto_recibido, monto),
                vuelto = COALESCE(vuelto, 0),
                subtotal = COALESCE(subtotal, MAX(0, monto - COALESCE(servicio, 0))),
                servicio = COALESCE(servicio, 0),
                version = CASE WHEN version IS NULL OR version < 1 THEN 1 ELSE version END,
                creado_en = COALESCE(creado_en, fecha, CURRENT_TIMESTAMP),
                actualizado_en = COALESCE(actualizado_en, fecha, CURRENT_TIMESTAMP),
                cajero_nombre_snapshot = COALESCE(
                    NULLIF(cajero_nombre_snapshot, ''),
                    (SELECT u.nombre FROM usuarios u WHERE u.id = pagos.cajero_usuario_id),
                    'Migración legacy'
                ),
                pagador_nombre_snapshot = COALESCE(
                    NULLIF(pagador_nombre_snapshot, ''),
                    (SELECT pf.pagador_nombre FROM prefacturas pf WHERE pf.id = pagos.prefactura_id),
                    (SELECT COALESCE(p.cliente_principal_snapshot, p.cliente_nombre, 'Cliente')
                     FROM pedidos p WHERE p.id = pagos.pedido_id)
                )
        `);

        const sequenceRow = await this.get(`
            SELECT ultimo_numero
            FROM secuencias_documentales
            WHERE tipo_documento = 'pago'
        `);
        const maxExisting = await this.get(`
            SELECT COALESCE(MAX(numero_secuencia), 0) AS maximo
            FROM pagos
        `);
        let nextNumber = Math.max(
            Number(sequenceRow?.ultimo_numero || 0),
            Number(maxExisting?.maximo || 0)
        );
        const unnumbered = await this.all(`
            SELECT id
            FROM pagos
            WHERE numero_secuencia IS NULL OR numero_pago IS NULL OR TRIM(numero_pago) = ''
            ORDER BY id
        `);
        for (const payment of unnumbered) {
            nextNumber += 1;
            const paymentNumber = `PG-${String(nextNumber).padStart(8, '0')}`;
            await this.run(`
                UPDATE pagos
                SET numero_secuencia = ?, numero_pago = ?
                WHERE id = ?
            `, [nextNumber, paymentNumber, payment.id]);
        }
        await this.run(`
            UPDATE secuencias_documentales
            SET ultimo_numero = ?,
                actualizado_en = CURRENT_TIMESTAMP,
                version = COALESCE(version, 1) + 1
            WHERE tipo_documento = 'pago'
              AND ultimo_numero < ?
        `, [nextNumber, nextNumber]);

        await this.run(`
            INSERT OR IGNORE INTO pago_componentes (pago_id, tipo, monto, creado_en)
            SELECT id, 'subtotal', COALESCE(subtotal, MAX(0, monto - COALESCE(servicio, 0))), COALESCE(fecha, CURRENT_TIMESTAMP)
            FROM pagos
        `);
        await this.run(`
            INSERT OR IGNORE INTO pago_componentes (pago_id, tipo, monto, creado_en)
            SELECT id, 'servicio', COALESCE(servicio, 0), COALESCE(fecha, CURRENT_TIMESTAMP)
            FROM pagos
        `);
        await this.run(`
            INSERT OR IGNORE INTO pago_medios (
                pago_id, ordinal, tipo, monto_aplicado,
                monto_recibido, vuelto, referencia, creado_en
            )
            SELECT
                id,
                1,
                CASE
                    WHEN metodo_pago IN ('efectivo', 'tarjeta', 'credito') THEN metodo_pago
                    ELSE 'efectivo'
                END,
                monto,
                COALESCE(monto_recibido, monto),
                COALESCE(vuelto, 0),
                referencia,
                COALESCE(fecha, CURRENT_TIMESTAMP)
            FROM pagos
            WHERE NOT EXISTS (
                SELECT 1 FROM pago_medios pm WHERE pm.pago_id = pagos.id
            )
        `);

        await this.run('CREATE INDEX IF NOT EXISTS idx_pagos_pedido ON pagos(pedido_id)');
        await this.run('CREATE INDEX IF NOT EXISTS idx_pagos_prefactura ON pagos(prefactura_id)');
        await this.run('CREATE INDEX IF NOT EXISTS idx_pagos_credito ON pagos(credito_id)');
        await this.run('CREATE INDEX IF NOT EXISTS idx_pagos_naturaleza ON pagos(naturaleza)');
        await this.run('CREATE INDEX IF NOT EXISTS idx_pagos_estado ON pagos(estado)');
        await this.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_pagos_numero_pago ON pagos(numero_pago)');
        await this.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_pagos_numero_secuencia ON pagos(numero_secuencia)');
        await this.run('CREATE INDEX IF NOT EXISTS idx_pago_componentes_pago ON pago_componentes(pago_id)');
        await this.run('CREATE INDEX IF NOT EXISTS idx_pago_medios_pago ON pago_medios(pago_id)');
        await this.run('CREATE INDEX IF NOT EXISTS idx_pago_medios_tipo ON pago_medios(tipo)');
        await this.run('CREATE INDEX IF NOT EXISTS idx_reversos_pago_pago ON reversos_pago(pago_id)');
        await this.run('CREATE INDEX IF NOT EXISTS idx_claves_idempotencia_recurso ON claves_idempotencia(recurso_tipo, recurso_id)');

        if (await this.tableExists('configuracion')) {
            await this.run(`
                INSERT OR REPLACE INTO configuracion (clave, valor, version_app)
                VALUES ('v3_payment_schema_ready', ?, ?)
            `, [new Date().toISOString(), APP_VERSION]);
        }
    }

    async ensureCreditSchema() {
        const creditColumns = [
            ['prefactura_id', 'INTEGER'],
            ['pago_apertura_id', 'INTEGER'],
            ['numero_credito', 'TEXT'],
            ['numero_secuencia', 'INTEGER'],
            ['pagador_nombre_snapshot', 'TEXT'],
            ['cliente_principal_snapshot', 'TEXT'],
            ['numero_cuenta_snapshot', 'TEXT'],
            ['numero_documento_snapshot', 'TEXT'],
            ['zona_nombre_snapshot', 'TEXT'],
            ['responsables_snapshot', "TEXT NOT NULL DEFAULT '[]'"],
            ['monto_original', 'REAL NOT NULL DEFAULT 0'],
            ['total_abonado', 'REAL NOT NULL DEFAULT 0'],
            ['saldo_pendiente', 'REAL NOT NULL DEFAULT 0'],
            ['estado', "TEXT NOT NULL DEFAULT 'pendiente'"],
            ['origen', "TEXT NOT NULL DEFAULT 'paymentservice'"],
            ['creado_por_usuario_id', 'INTEGER'],
            ['creado_por_nombre_snapshot', 'TEXT'],
            ['autorizado_por_usuario_id', 'INTEGER'],
            ['clave_idempotencia', 'TEXT'],
            ['solicitud_fingerprint', 'TEXT'],
            ['observacion', 'TEXT'],
            ['fecha_ultimo_abono', 'TEXT'],
            ['fecha_saldo', 'TEXT'],
            ['fecha_anulacion', 'TEXT'],
            ['motivo_anulacion', 'TEXT'],
            ['version', 'INTEGER NOT NULL DEFAULT 1'],
            ['creado_en', 'TEXT'],
            ['actualizado_en', 'TEXT']
        ];
        for (const [column, definition] of creditColumns) {
            await this.ensureColumn('cuentas_credito', column, definition);
        }

        await this.run(`CREATE TABLE IF NOT EXISTS historial_creditos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            credito_id INTEGER NOT NULL,
            evento TEXT NOT NULL,
            estado_anterior TEXT,
            estado_nuevo TEXT,
            usuario_id INTEGER,
            usuario_nombre_snapshot TEXT,
            detalle TEXT,
            fecha TEXT NOT NULL,
            FOREIGN KEY (credito_id) REFERENCES cuentas_credito (id) ON DELETE CASCADE,
            FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE SET NULL
        )`);

        await this.run(`
            INSERT OR IGNORE INTO secuencias_documentales (
                tipo_documento, prefijo, longitud, ultimo_numero,
                version, creado_en, actualizado_en
            ) VALUES ('credito', 'CR', 8, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `);

        await this.run(`
            UPDATE cuentas_credito
            SET monto_original = CASE
                    WHEN COALESCE(monto_original, 0) > 0 THEN monto_original
                    ELSE COALESCE(monto_total, 0) + COALESCE((
                        SELECT SUM(pc.monto_pagado)
                        FROM pagos_creditos pc
                        WHERE pc.credito_id = cuentas_credito.id
                    ), 0)
                END,
                total_abonado = CASE
                    WHEN COALESCE(total_abonado, 0) > 0 THEN total_abonado
                    ELSE COALESCE((
                        SELECT SUM(pc.monto_pagado)
                        FROM pagos_creditos pc
                        WHERE pc.credito_id = cuentas_credito.id
                    ), 0)
                END,
                saldo_pendiente = CASE
                    WHEN saldo_pendiente IS NULL OR saldo_pendiente < 0 THEN MAX(0, COALESCE(monto_total, 0))
                    WHEN saldo_pendiente = 0 AND COALESCE(monto_total, 0) > 0 THEN monto_total
                    ELSE saldo_pendiente
                END,
                estado = CASE
                    WHEN estado IN ('pendiente', 'parcial', 'saldado', 'anulado') THEN estado
                    WHEN COALESCE(monto_total, 0) <= 0 THEN 'saldado'
                    WHEN COALESCE((SELECT SUM(pc.monto_pagado) FROM pagos_creditos pc WHERE pc.credito_id = cuentas_credito.id), 0) > 0 THEN 'parcial'
                    ELSE 'pendiente'
                END,
                origen = CASE
                    WHEN origen IS NULL OR TRIM(origen) = '' THEN 'legacy'
                    ELSE origen
                END,
                pagador_nombre_snapshot = COALESCE(NULLIF(pagador_nombre_snapshot, ''), cliente_nombre),
                cliente_principal_snapshot = COALESCE(
                    NULLIF(cliente_principal_snapshot, ''),
                    (SELECT COALESCE(p.cliente_principal_snapshot, p.cliente_nombre) FROM pedidos p WHERE p.id = cuentas_credito.pedido_id),
                    cliente_nombre
                ),
                numero_cuenta_snapshot = COALESCE(
                    NULLIF(numero_cuenta_snapshot, ''),
                    (SELECT p.numero_cuenta FROM pedidos p WHERE p.id = cuentas_credito.pedido_id)
                ),
                numero_documento_snapshot = COALESCE(
                    NULLIF(numero_documento_snapshot, ''),
                    (SELECT pf.numero_documento FROM prefacturas pf WHERE pf.id = cuentas_credito.prefactura_id)
                ),
                creado_por_nombre_snapshot = COALESCE(NULLIF(creado_por_nombre_snapshot, ''), usuario_origen, 'Migración legacy'),
                autorizado_por = COALESCE(NULLIF(autorizado_por, ''), 'Migración legacy'),
                responsables_snapshot = COALESCE(NULLIF(responsables_snapshot, ''), '[]'),
                version = CASE WHEN version IS NULL OR version < 1 THEN 1 ELSE version END,
                creado_en = COALESCE(creado_en, fecha, CURRENT_TIMESTAMP),
                actualizado_en = COALESCE(actualizado_en, fecha, CURRENT_TIMESTAMP)
        `);

        const sequenceRow = await this.get(`
            SELECT ultimo_numero FROM secuencias_documentales WHERE tipo_documento = 'credito'
        `);
        const maxExisting = await this.get(`
            SELECT COALESCE(MAX(numero_secuencia), 0) AS maximo FROM cuentas_credito
        `);
        let nextNumber = Math.max(Number(sequenceRow?.ultimo_numero || 0), Number(maxExisting?.maximo || 0));
        const unnumbered = await this.all(`
            SELECT id FROM cuentas_credito
            WHERE numero_secuencia IS NULL OR numero_credito IS NULL OR TRIM(numero_credito) = ''
            ORDER BY id
        `);
        for (const credit of unnumbered) {
            nextNumber += 1;
            await this.run(`
                UPDATE cuentas_credito
                SET numero_secuencia = ?, numero_credito = ?
                WHERE id = ?
            `, [nextNumber, `CR-${String(nextNumber).padStart(8, '0')}`, credit.id]);
        }
        await this.run(`
            UPDATE secuencias_documentales
            SET ultimo_numero = ?, actualizado_en = CURRENT_TIMESTAMP,
                version = COALESCE(version, 1) + 1
            WHERE tipo_documento = 'credito' AND ultimo_numero < ?
        `, [nextNumber, nextNumber]);

        await this.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_cuentas_credito_numero ON cuentas_credito(numero_credito)');
        await this.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_cuentas_credito_secuencia ON cuentas_credito(numero_secuencia)');
        await this.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_cuentas_credito_prefactura_unique ON cuentas_credito(prefactura_id) WHERE prefactura_id IS NOT NULL');
        await this.run('CREATE INDEX IF NOT EXISTS idx_cuentas_credito_pedido ON cuentas_credito(pedido_id)');
        await this.run('CREATE INDEX IF NOT EXISTS idx_cuentas_credito_estado ON cuentas_credito(estado)');
        await this.run('CREATE INDEX IF NOT EXISTS idx_historial_creditos_credito ON historial_creditos(credito_id)');

        if (await this.tableExists('configuracion')) {
            await this.run(`
                INSERT OR REPLACE INTO configuracion (clave, valor, version_app)
                VALUES ('v3_credit_schema_ready', ?, ?)
            `, [new Date().toISOString(), APP_VERSION]);
        }
    }

    async ensureGlobalAccountColumns() {
        await this.ensureColumn('pedidos', 'numero_cuenta', 'TEXT');
        await this.ensureColumn('pedidos', 'estado_operativo', "TEXT NOT NULL DEFAULT 'abierta'");
        await this.ensureColumn('pedidos', 'estado_financiero', "TEXT NOT NULL DEFAULT 'sin_documentos'");
        await this.ensureColumn('pedidos', 'total_pagado', 'REAL NOT NULL DEFAULT 0');
        await this.ensureColumn('pedidos', 'saldo_pendiente', 'REAL NOT NULL DEFAULT 0');
        await this.ensureColumn('pedidos', 'fecha_apertura', 'TEXT');
        await this.ensureColumn('pedidos', 'fecha_conciliacion', 'TEXT');
        await this.ensureColumn('pedidos', 'fecha_cierre', 'TEXT');
        await this.ensureColumn('pedidos', 'finalizada_por_usuario_id', 'INTEGER');
        await this.ensureColumn('pedidos', 'finalizada_por_nombre_snapshot', 'TEXT');
        await this.ensureColumn('pedidos', 'observacion_cierre', 'TEXT');
        await this.ensureColumn('pedidos', 'actualizado_en', 'TEXT');
        await this.ensureColumn('pedidos', 'version', 'INTEGER NOT NULL DEFAULT 1');
        await this.ensureColumn('pedidos', 'mesa_numero_snapshot', 'INTEGER');
        await this.ensureColumn('pedidos', 'mesa_tipo_snapshot', 'TEXT');
        await this.ensureColumn('pedidos', 'zona_id_snapshot', 'INTEGER');
        await this.ensureColumn('pedidos', 'zona_nombre_snapshot', 'TEXT');
        await this.ensureColumn('pedidos', 'cliente_principal_snapshot', 'TEXT');
    }

    async migrateGlobalAccounts() {
        const exists = await this.tableExists('pedidos');
        if (!exists) return;

        await this.run(`CREATE TABLE IF NOT EXISTS cuenta_responsables (
            pedido_id INTEGER NOT NULL,
            usuario_id INTEGER,
            rol_trabajo_id INTEGER,
            usuario_nombre_snapshot TEXT NOT NULL,
            rol_nombre_snapshot TEXT,
            es_principal INTEGER NOT NULL DEFAULT 0,
            fecha_asignacion_snapshot TEXT NOT NULL,
            PRIMARY KEY (pedido_id, usuario_nombre_snapshot, fecha_asignacion_snapshot),
            FOREIGN KEY (pedido_id) REFERENCES pedidos (id) ON DELETE CASCADE,
            FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE SET NULL,
            FOREIGN KEY (rol_trabajo_id) REFERENCES roles_trabajo (id) ON DELETE SET NULL
        )`);

        const hasConfiguration = await this.tableExists('configuracion');
        const backfillMarker = hasConfiguration
            ? await this.get("SELECT valor FROM configuracion WHERE clave = 'v3_global_account_backfill_done'")
            : null;

        if (backfillMarker) {
            await this.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_pedidos_numero_cuenta ON pedidos(numero_cuenta)');
            await this.run('CREATE INDEX IF NOT EXISTS idx_pedidos_estado_operativo ON pedidos(estado_operativo)');
            await this.run('CREATE INDEX IF NOT EXISTS idx_pedidos_estado_financiero ON pedidos(estado_financiero)');
            await this.run('CREATE INDEX IF NOT EXISTS idx_cuenta_responsables_pedido ON cuenta_responsables(pedido_id)');
            await this.run('CREATE INDEX IF NOT EXISTS idx_cuenta_responsables_usuario ON cuenta_responsables(usuario_id)');
            return;
        }

        const paymentColumns = await this.getColumns('pagos');
        const confirmedPaymentFilter = paymentColumns.includes('estado')
            ? " AND COALESCE(pg.estado, 'confirmado') = 'confirmado'"
            : '';
        const accounts = await this.all(`
            SELECT
                p.id,
                p.estado,
                p.fecha,
                p.total,
                p.total_con_servicio,
                p.cliente_nombre,
                p.numero_cuenta,
                p.fecha_apertura,
                m.numero AS mesa_numero,
                m.tipo_asiento AS mesa_tipo,
                m.zona_id,
                z.nombre AS zona_nombre,
                COALESCE((SELECT SUM(pg.monto) FROM pagos pg WHERE pg.pedido_id = p.id${confirmedPaymentFilter}), 0) AS total_pagado_calculado
            FROM pedidos p
            LEFT JOIN mesas m ON m.id = p.mesa_id
            LEFT JOIN zonas z ON z.id = m.zona_id
            ORDER BY p.id
        `);

        for (const account of accounts) {
            const number = account.numero_cuenta || `CTA-${String(account.id).padStart(8, '0')}`;
            const total = Number(account.total_con_servicio ?? account.total ?? 0) || 0;
            const paid = Number(account.total_pagado_calculado || 0) || 0;
            const balance = Math.max(0, Math.round((total - paid + Number.EPSILON) * 100) / 100);
            const operationalState = account.estado === 'cancelado'
                ? 'cancelada'
                : (account.estado === 'pendiente' ? 'abierta' : 'cerrada');
            const financialState = account.estado === 'credito'
                ? 'credito'
                : (account.estado === 'pagado' || (total > 0 && balance <= 0)
                    ? 'conciliada'
                    : (paid > 0 ? 'parcial' : 'sin_documentos'));
            const reconciledAt = financialState === 'conciliada' ? account.fecha : null;
            const closedAt = operationalState === 'cerrada' || operationalState === 'cancelada' ? account.fecha : null;

            await this.run(`
                UPDATE pedidos
                SET numero_cuenta = ?,
                    estado_operativo = ?,
                    estado_financiero = ?,
                    total_pagado = ?,
                    saldo_pendiente = ?,
                    fecha_apertura = COALESCE(fecha_apertura, fecha, ?),
                    fecha_conciliacion = COALESCE(fecha_conciliacion, ?),
                    fecha_cierre = COALESCE(fecha_cierre, ?),
                    actualizado_en = COALESCE(actualizado_en, fecha, ?),
                    version = CASE WHEN version IS NULL OR version < 1 THEN 1 ELSE version END,
                    mesa_numero_snapshot = COALESCE(mesa_numero_snapshot, ?),
                    mesa_tipo_snapshot = COALESCE(mesa_tipo_snapshot, ?),
                    zona_id_snapshot = COALESCE(zona_id_snapshot, ?),
                    zona_nombre_snapshot = COALESCE(zona_nombre_snapshot, ?),
                    cliente_principal_snapshot = COALESCE(cliente_principal_snapshot, cliente_nombre, ?)
                WHERE id = ?
            `, [
                number,
                operationalState,
                financialState,
                paid,
                balance,
                account.fecha,
                reconciledAt,
                closedAt,
                account.fecha,
                account.mesa_numero,
                account.mesa_tipo,
                account.zona_id,
                account.zona_nombre,
                account.cliente_nombre,
                account.id
            ]);
        }

        await this.run(`
            INSERT OR IGNORE INTO cuenta_responsables (
                pedido_id, usuario_id, rol_trabajo_id, usuario_nombre_snapshot,
                rol_nombre_snapshot, es_principal, fecha_asignacion_snapshot
            )
            SELECT
                p.id,
                mr.usuario_id,
                mr.rol_trabajo_id,
                u.nombre,
                rt.nombre,
                CASE WHEN mr.usuario_id = p.usuario_id THEN 1 ELSE 0 END,
                COALESCE(mr.fecha_asignacion, p.fecha)
            FROM pedidos p
            JOIN mesa_responsables mr ON mr.mesa_id = p.mesa_id
            JOIN usuarios u ON u.id = mr.usuario_id
            LEFT JOIN roles_trabajo rt ON rt.id = mr.rol_trabajo_id
        `);

        await this.run(`
            INSERT OR IGNORE INTO cuenta_responsables (
                pedido_id, usuario_id, rol_trabajo_id, usuario_nombre_snapshot,
                rol_nombre_snapshot, es_principal, fecha_asignacion_snapshot
            )
            SELECT
                p.id,
                p.usuario_id,
                p.rol_trabajo_id,
                u.nombre,
                rt.nombre,
                1,
                p.fecha
            FROM pedidos p
            JOIN usuarios u ON u.id = p.usuario_id
            LEFT JOIN roles_trabajo rt ON rt.id = p.rol_trabajo_id
            WHERE NOT EXISTS (
                SELECT 1 FROM cuenta_responsables cr WHERE cr.pedido_id = p.id
            )
        `);

        await this.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_pedidos_numero_cuenta ON pedidos(numero_cuenta)');
        await this.run('CREATE INDEX IF NOT EXISTS idx_pedidos_estado_operativo ON pedidos(estado_operativo)');
        await this.run('CREATE INDEX IF NOT EXISTS idx_pedidos_estado_financiero ON pedidos(estado_financiero)');
        await this.run('CREATE INDEX IF NOT EXISTS idx_cuenta_responsables_pedido ON cuenta_responsables(pedido_id)');
        await this.run('CREATE INDEX IF NOT EXISTS idx_cuenta_responsables_usuario ON cuenta_responsables(usuario_id)');

        if (hasConfiguration) {
            await this.run(`
                INSERT OR REPLACE INTO configuracion (clave, valor, version_app)
                VALUES ('v3_global_account_backfill_done', ?, ?)
            `, [new Date().toISOString(), APP_VERSION]);
        }
    }

    async normalizeLegacyTableColumns() {
        // Versiones viejas tenían mesas.tipo en lugar de tipo_asiento.
        const columns = await this.getColumns('mesas');
        if (columns.includes('tipo') && columns.includes('tipo_asiento')) {
            await this.run(`
                UPDATE mesas
                SET tipo_asiento = COALESCE(NULLIF(tipo_asiento, ''), NULLIF(tipo, ''), 'mesa')
            `);
        }

        await this.run(`UPDATE mesas SET zona = COALESCE(NULLIF(zona, ''), 'salon')`);
        await this.run(`UPDATE mesas SET tipo_asiento = COALESCE(NULLIF(tipo_asiento, ''), 'mesa')`);
        await this.run(`UPDATE mesas SET estado = 'libre' WHERE estado IS NULL OR estado NOT IN ('libre', 'ocupada', 'reservada')`);
        await this.run(`UPDATE mesas SET activo = 1 WHERE activo IS NULL`);
        await this.normalizeLegacySeatCompatibilityValues();
        await this.run(`UPDATE mesas SET capacidad = 1 WHERE zona = 'bar' AND tipo_asiento = 'banco' AND (capacidad IS NULL OR capacidad < 1)`);
    }

    async normalizeLegacySeatCompatibilityValues() {
        const rows = await this.all('SELECT id, zona, tipo_asiento, capacidad FROM mesas');

        for (const row of rows) {
            const currentZona = String(row.zona || 'salon').trim();
            const currentTipo = String(row.tipo_asiento || 'mesa').trim();
            const zonaSlug = this.normalizeDynamicSlug(currentZona, 'salon');
            const tipoSlug = this.normalizeDynamicSlug(currentTipo, 'mesa');

            let nextZona = currentZona;
            let nextTipo = currentTipo;
            let nextCapacidad = row.capacidad;

            if (zonaSlug === 'barra') {
                // Compatibilidad histórica: la Barra se operaba como bar + banco.
                // El modelo dinámico la separa como zona_id=Barra, pero los campos legacy
                // se mantienen compatibles para no romper pantallas actuales.
                nextZona = 'bar';
                nextTipo = 'banco';
                nextCapacidad = 1;
            } else if (zonaSlug === 'salon') {
                nextZona = 'salon';
                nextTipo = 'mesa';
            } else if (zonaSlug === 'bar') {
                nextZona = 'bar';
                nextTipo = tipoSlug === 'banco' ? 'banco' : 'mesa';
                if (nextTipo === 'banco') {
                    nextCapacidad = 1;
                }
            } else {
                // Zonas personalizadas heredadas se conservan como texto original,
                // pero el tipo de puesto se normaliza solo si corresponde a los tipos base.
                nextTipo = ['mesa', 'banco'].includes(tipoSlug) ? tipoSlug : currentTipo;
                if (nextTipo === 'banco') {
                    nextCapacidad = 1;
                }
            }

            if (nextZona !== currentZona || nextTipo !== currentTipo || nextCapacidad !== row.capacidad) {
                await this.run(
                    'UPDATE mesas SET zona = ?, tipo_asiento = ?, capacidad = ? WHERE id = ?',
                    [nextZona, nextTipo, nextCapacidad || 1, row.id]
                );
            }
        }
    }

    async rebuildLegacyForeignKeys() {
        // Las columnas agregadas mediante ALTER TABLE pueden quedar en NULL en filas
        // legacy. La reconstrucción copia valores explícitos, por lo que los DEFAULT
        // de la tabla nueva no se aplican a esos NULL. Normalizamos primero los campos
        // NOT NULL de comandas para que una base real parcialmente migrada pueda
        // reconstruirse sin perder historial ni violar restricciones.
        await this.normalizeKitchenRowsForLegacyRebuild();

        await this.rebuildTable('pedidos', `CREATE TABLE pedidos_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            mesa_id INTEGER NOT NULL,
            usuario_id INTEGER NOT NULL,
            rol_trabajo_id INTEGER,
            fecha TEXT NOT NULL,
            estado TEXT NOT NULL CHECK(estado IN ('pendiente', 'pagado', 'cancelado', 'credito')),
            total REAL NOT NULL DEFAULT 0,
            cliente_nombre TEXT,
            aplica_servicio INTEGER,
            porcentaje_servicio REAL,
            monto_servicio REAL NOT NULL DEFAULT 0,
            total_con_servicio REAL,
            numero_cuenta TEXT,
            estado_operativo TEXT NOT NULL DEFAULT 'abierta',
            estado_financiero TEXT NOT NULL DEFAULT 'sin_documentos',
            total_pagado REAL NOT NULL DEFAULT 0,
            saldo_pendiente REAL NOT NULL DEFAULT 0,
            fecha_apertura TEXT,
            fecha_conciliacion TEXT,
            fecha_cierre TEXT,
            actualizado_en TEXT,
            version INTEGER NOT NULL DEFAULT 1,
            mesa_numero_snapshot INTEGER,
            mesa_tipo_snapshot TEXT,
            zona_id_snapshot INTEGER,
            zona_nombre_snapshot TEXT,
            cliente_principal_snapshot TEXT,
            FOREIGN KEY (mesa_id) REFERENCES mesas (id) ON DELETE RESTRICT,
            FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE RESTRICT,
            FOREIGN KEY (rol_trabajo_id) REFERENCES roles_trabajo (id) ON DELETE SET NULL
        )`, [
            'id', 'mesa_id', 'usuario_id', 'rol_trabajo_id', 'fecha', 'estado', 'total',
            'cliente_nombre', 'aplica_servicio', 'porcentaje_servicio', 'monto_servicio',
            'total_con_servicio', 'numero_cuenta', 'estado_operativo', 'estado_financiero',
            'total_pagado', 'saldo_pendiente', 'fecha_apertura', 'fecha_conciliacion',
            'fecha_cierre', 'actualizado_en', 'version', 'mesa_numero_snapshot',
            'mesa_tipo_snapshot', 'zona_id_snapshot', 'zona_nombre_snapshot',
            'cliente_principal_snapshot'
        ]);

        await this.rebuildTable('pedido_productos', `CREATE TABLE pedido_productos_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pedido_id INTEGER NOT NULL,
            producto_id INTEGER NOT NULL,
            cantidad INTEGER NOT NULL,
            cantidad_asignada INTEGER NOT NULL DEFAULT 0,
            precio_unitario REAL NOT NULL,
            precio_original REAL NOT NULL,
            creado_en TEXT DEFAULT CURRENT_TIMESTAMP,
            actualizado_en TEXT,
            version INTEGER NOT NULL DEFAULT 1,
            presentacion_id INTEGER,
            producto_nombre_snapshot TEXT,
            presentacion_nombre_snapshot TEXT,
            presentacion_cantidad_snapshot TEXT,
            aplica_servicio_snapshot INTEGER NOT NULL DEFAULT 0,
            porcentaje_servicio_snapshot REAL NOT NULL DEFAULT 0,
            servicio_unitario_snapshot REAL NOT NULL DEFAULT 0,
            observacion_snapshot TEXT,
            adicionales_snapshot TEXT NOT NULL DEFAULT '[]',
            usuario_solicitante_id INTEGER,
            usuario_solicitante_nombre_snapshot TEXT,
            FOREIGN KEY (pedido_id) REFERENCES pedidos (id) ON DELETE CASCADE,
            FOREIGN KEY (producto_id) REFERENCES productos (id) ON DELETE RESTRICT,
            FOREIGN KEY (presentacion_id) REFERENCES presentaciones (id) ON DELETE SET NULL,
            FOREIGN KEY (usuario_solicitante_id) REFERENCES usuarios (id) ON DELETE SET NULL
        )`, [
            'id', 'pedido_id', 'producto_id', 'cantidad', 'cantidad_asignada',
            'precio_unitario', 'precio_original', 'creado_en', 'actualizado_en',
            'version', 'presentacion_id', 'producto_nombre_snapshot',
            'presentacion_nombre_snapshot', 'presentacion_cantidad_snapshot',
            'aplica_servicio_snapshot', 'porcentaje_servicio_snapshot',
            'servicio_unitario_snapshot', 'observacion_snapshot',
            'adicionales_snapshot', 'usuario_solicitante_id',
            'usuario_solicitante_nombre_snapshot'
        ]);

        await this.rebuildTable('pagos', `CREATE TABLE pagos_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pedido_id INTEGER NOT NULL,
            prefactura_id INTEGER,
            credito_id INTEGER,
            numero_pago TEXT UNIQUE,
            numero_secuencia INTEGER UNIQUE,
            naturaleza TEXT NOT NULL DEFAULT 'liquidacion_venta' CHECK(naturaleza IN ('liquidacion_venta', 'cobro_credito')),
            estado TEXT NOT NULL DEFAULT 'confirmado' CHECK(estado IN ('pendiente', 'confirmado', 'anulado')),
            metodo_pago TEXT NOT NULL CHECK(metodo_pago IN ('efectivo', 'tarjeta', 'credito')),
            metodo_pago_v3 TEXT,
            monto REAL NOT NULL CHECK(monto > 0),
            monto_recibido REAL,
            vuelto REAL NOT NULL DEFAULT 0,
            subtotal REAL,
            servicio REAL NOT NULL DEFAULT 0,
            porcentaje_servicio REAL,
            aplica_servicio INTEGER,
            referencia TEXT,
            cajero_usuario_id INTEGER,
            cajero_nombre_snapshot TEXT,
            pagador_nombre_snapshot TEXT,
            fecha TEXT NOT NULL,
            fecha_anulacion TEXT,
            anulado_por_usuario_id INTEGER,
            anulado_por_nombre_snapshot TEXT,
            motivo_anulacion TEXT,
            version INTEGER NOT NULL DEFAULT 1,
            creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            actualizado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (pedido_id) REFERENCES pedidos (id) ON DELETE CASCADE,
            FOREIGN KEY (prefactura_id) REFERENCES prefacturas (id) ON DELETE RESTRICT,
            FOREIGN KEY (credito_id) REFERENCES cuentas_credito (id) ON DELETE RESTRICT,
            FOREIGN KEY (cajero_usuario_id) REFERENCES usuarios (id) ON DELETE SET NULL,
            FOREIGN KEY (anulado_por_usuario_id) REFERENCES usuarios (id) ON DELETE SET NULL
        )`, [
            'id', 'pedido_id', 'prefactura_id', 'credito_id', 'numero_pago', 'numero_secuencia',
            'naturaleza', 'estado', 'metodo_pago', 'metodo_pago_v3', 'monto',
            'monto_recibido', 'vuelto', 'subtotal', 'servicio',
            'porcentaje_servicio', 'aplica_servicio', 'referencia',
            'cajero_usuario_id', 'cajero_nombre_snapshot', 'pagador_nombre_snapshot',
            'fecha', 'fecha_anulacion', 'anulado_por_usuario_id',
            'anulado_por_nombre_snapshot', 'motivo_anulacion', 'version',
            'creado_en', 'actualizado_en'
        ]);

        await this.rebuildTable('cuentas_credito', `CREATE TABLE cuentas_credito_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pedido_id INTEGER,
            prefactura_id INTEGER,
            pago_apertura_id INTEGER,
            numero_credito TEXT UNIQUE,
            numero_secuencia INTEGER UNIQUE,
            cliente_nombre TEXT NOT NULL,
            pagador_nombre_snapshot TEXT,
            cliente_principal_snapshot TEXT,
            numero_cuenta_snapshot TEXT,
            numero_documento_snapshot TEXT,
            mesa TEXT,
            zona_nombre_snapshot TEXT,
            responsables_snapshot TEXT NOT NULL DEFAULT '[]',
            monto_original REAL NOT NULL DEFAULT 0,
            total_abonado REAL NOT NULL DEFAULT 0,
            saldo_pendiente REAL NOT NULL DEFAULT 0,
            monto_total REAL NOT NULL,
            estado TEXT NOT NULL DEFAULT 'pendiente',
            origen TEXT NOT NULL DEFAULT 'paymentservice',
            usuario_origen TEXT,
            creado_por_usuario_id INTEGER,
            creado_por_nombre_snapshot TEXT,
            autorizado_por_usuario_id INTEGER,
            autorizado_por TEXT,
            clave_idempotencia TEXT UNIQUE,
            solicitud_fingerprint TEXT,
            observacion TEXT,
            fecha TEXT NOT NULL,
            fecha_ultimo_abono TEXT,
            fecha_saldo TEXT,
            fecha_anulacion TEXT,
            motivo_anulacion TEXT,
            version INTEGER NOT NULL DEFAULT 1,
            creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            actualizado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(prefactura_id),
            FOREIGN KEY (pedido_id) REFERENCES pedidos (id) ON DELETE SET NULL,
            FOREIGN KEY (prefactura_id) REFERENCES prefacturas (id) ON DELETE RESTRICT,
            FOREIGN KEY (pago_apertura_id) REFERENCES pagos (id) ON DELETE RESTRICT,
            FOREIGN KEY (creado_por_usuario_id) REFERENCES usuarios (id) ON DELETE SET NULL,
            FOREIGN KEY (autorizado_por_usuario_id) REFERENCES usuarios (id) ON DELETE SET NULL
        )`, [
            'id', 'pedido_id', 'prefactura_id', 'pago_apertura_id',
            'numero_credito', 'numero_secuencia', 'cliente_nombre',
            'pagador_nombre_snapshot', 'cliente_principal_snapshot',
            'numero_cuenta_snapshot', 'numero_documento_snapshot', 'mesa',
            'zona_nombre_snapshot', 'responsables_snapshot', 'monto_original',
            'total_abonado', 'saldo_pendiente', 'monto_total', 'estado', 'origen',
            'usuario_origen', 'creado_por_usuario_id', 'creado_por_nombre_snapshot',
            'autorizado_por_usuario_id', 'autorizado_por', 'clave_idempotencia',
            'solicitud_fingerprint', 'observacion', 'fecha', 'fecha_ultimo_abono',
            'fecha_saldo', 'fecha_anulacion', 'motivo_anulacion', 'version',
            'creado_en', 'actualizado_en'
        ]);

        await this.rebuildTable('creditos', `CREATE TABLE creditos_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cuenta_id INTEGER,
            cliente TEXT,
            total NUMERIC NOT NULL DEFAULT 0,
            estado TEXT DEFAULT 'Pendiente',
            fecha TEXT NOT NULL,
            autorizado_por TEXT,
            FOREIGN KEY (cuenta_id) REFERENCES cuentas_credito (id) ON DELETE SET NULL
        )`, ['id', 'cuenta_id', 'cliente', 'total', 'estado', 'fecha', 'autorizado_por']);

        await this.rebuildTable('comandas', `CREATE TABLE comandas_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            mesa_id INTEGER,
            productos_cocina TEXT NOT NULL DEFAULT '[]',
            fecha_impresion TEXT,
            estado TEXT NOT NULL DEFAULT 'pendiente' CHECK(estado IN ('pendiente', 'impresa', 'entregada')),
            pedido_id INTEGER,
            comanda_origen_id INTEGER,
            numero_comanda TEXT UNIQUE,
            numero_secuencia INTEGER UNIQUE,
            destino TEXT NOT NULL DEFAULT 'cocina',
            estado_operativo TEXT NOT NULL DEFAULT 'pendiente',
            estado_impresion TEXT NOT NULL DEFAULT 'pendiente',
            usuario_solicitante_id INTEGER,
            usuario_solicitante_nombre_snapshot TEXT,
            numero_cuenta_snapshot TEXT,
            mesa_numero_snapshot INTEGER,
            mesa_tipo_snapshot TEXT,
            zona_id_snapshot INTEGER,
            zona_nombre_snapshot TEXT,
            solicitada_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            enviada_en TEXT,
            clave_idempotencia TEXT,
            solicitud_fingerprint TEXT,
            motivo TEXT,
            origen TEXT NOT NULL DEFAULT 'normalizada',
            version INTEGER NOT NULL DEFAULT 1,
            FOREIGN KEY (mesa_id) REFERENCES mesas (id) ON DELETE SET NULL,
            FOREIGN KEY (pedido_id) REFERENCES pedidos (id) ON DELETE SET NULL,
            FOREIGN KEY (comanda_origen_id) REFERENCES comandas (id) ON DELETE SET NULL,
            FOREIGN KEY (usuario_solicitante_id) REFERENCES usuarios (id) ON DELETE SET NULL
        )`, [
            'id', 'mesa_id', 'productos_cocina', 'fecha_impresion', 'estado',
            'pedido_id', 'comanda_origen_id', 'numero_comanda', 'numero_secuencia',
            'destino', 'estado_operativo', 'estado_impresion',
            'usuario_solicitante_id', 'usuario_solicitante_nombre_snapshot',
            'numero_cuenta_snapshot', 'mesa_numero_snapshot', 'mesa_tipo_snapshot',
            'zona_id_snapshot', 'zona_nombre_snapshot', 'solicitada_en', 'enviada_en',
            'clave_idempotencia', 'solicitud_fingerprint', 'motivo', 'origen', 'version'
        ]);
    }

    async normalizeKitchenRowsForLegacyRebuild() {
        if (!await this.tableExists('comandas')) return;

        const columns = await this.getColumns('comandas');
        if (!columns.includes('solicitada_en')) return;

        await this.run(`
            UPDATE comandas
            SET productos_cocina = COALESCE(productos_cocina, '[]'),
                estado = CASE
                    WHEN estado IN ('pendiente', 'impresa', 'entregada') THEN estado
                    ELSE 'pendiente'
                END,
                destino = COALESCE(NULLIF(TRIM(destino), ''), 'cocina'),
                estado_operativo = COALESCE(NULLIF(TRIM(estado_operativo), ''), 'pendiente'),
                estado_impresion = COALESCE(NULLIF(TRIM(estado_impresion), ''), 'pendiente'),
                solicitada_en = COALESCE(
                    NULLIF(TRIM(solicitada_en), ''),
                    NULLIF(TRIM(fecha_impresion), ''),
                    CURRENT_TIMESTAMP
                ),
                origen = COALESCE(NULLIF(TRIM(origen), ''), 'legacy'),
                version = CASE WHEN version IS NULL OR version < 1 THEN 1 ELSE version END
            WHERE productos_cocina IS NULL
               OR estado IS NULL
               OR estado NOT IN ('pendiente', 'impresa', 'entregada')
               OR destino IS NULL OR TRIM(destino) = ''
               OR estado_operativo IS NULL OR TRIM(estado_operativo) = ''
               OR estado_impresion IS NULL OR TRIM(estado_impresion) = ''
               OR solicitada_en IS NULL OR TRIM(solicitada_en) = ''
               OR origen IS NULL OR TRIM(origen) = ''
               OR version IS NULL OR version < 1
        `);
    }

    async rebuildTable(tableName, createNewSql, wantedColumns) {
        const exists = await this.tableExists(tableName);
        if (!exists) return;

        const currentSqlRow = await this.get(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
            [tableName]
        );
        const currentSql = (currentSqlRow?.sql || '').toLowerCase();
        const shouldRebuild = currentSql.includes('mesas_old') ||
            currentSql.includes('pedidos_backup') ||
            currentSql.includes('references cuentas(') ||
            (tableName === 'cuentas_credito' && !currentSql.includes('references pedidos')) ||
            (tableName === 'comandas' && (
                currentSql.includes('mesa_id integer not null') ||
                currentSql.includes('references mesas (id) on delete cascade') ||
                currentSql.includes('references pedidos (id) on delete cascade')
            )) ||
            !currentSql.includes(`${tableName} (`);

        if (!shouldRebuild) return;

        const existingColumns = await this.getColumns(tableName);
        const insertColumns = wantedColumns.filter(col => existingColumns.includes(col));
        if (insertColumns.length === 0) return;

        const newTable = `${tableName}_new`;
        await this.run(`DROP TABLE IF EXISTS ${newTable}`);
        await this.run(createNewSql);
        await this.run(`
            INSERT INTO ${newTable} (${insertColumns.join(', ')})
            SELECT ${insertColumns.join(', ')} FROM ${tableName}
        `);
        await this.run(`DROP TABLE ${tableName}`);
        await this.run(`ALTER TABLE ${newTable} RENAME TO ${tableName}`);
    }

    async rebuildPresentacionesForPresentationTypes() {
        const exists = await this.tableExists('presentaciones');
        if (!exists) return;

        const currentSqlRow = await this.get(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'presentaciones'"
        );
        const currentSql = (currentSqlRow?.sql || '').toLowerCase();

        const hasGlobalNameUnique = currentSql.includes('nombre text not null unique');
        const hasTipoColumn = currentSql.includes('tipo_presentacion_id');
        const hasCompositeUnique = currentSql.includes('unique(tipo_presentacion_id, nombre, cantidad)');

        if (!hasGlobalNameUnique && hasTipoColumn && hasCompositeUnique) return;

        const existingColumns = await this.getColumns('presentaciones');
        const wantedColumns = ['id', 'nombre', 'tipo', 'cantidad', 'tipo_presentacion_id', 'activo', 'creado_en', 'actualizado_en'];
        const insertColumns = wantedColumns.filter(col => existingColumns.includes(col));
        if (!insertColumns.includes('id') || !insertColumns.includes('nombre')) return;

        await this.run(`DROP TABLE IF EXISTS presentaciones_new`);
        await this.run(`CREATE TABLE presentaciones_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL,
            tipo TEXT DEFAULT 'tamaño',
            cantidad TEXT,
            tipo_presentacion_id INTEGER,
            activo INTEGER NOT NULL DEFAULT 1,
            creado_en TEXT,
            actualizado_en TEXT,
            UNIQUE(tipo_presentacion_id, nombre, cantidad),
            FOREIGN KEY (tipo_presentacion_id) REFERENCES tipos_presentacion (id) ON DELETE SET NULL
        )`);

        await this.run(`
            INSERT INTO presentaciones_new (${insertColumns.join(', ')})
            SELECT ${insertColumns.join(', ')} FROM presentaciones
        `);

        await this.run(`DROP TABLE presentaciones`);
        await this.run(`ALTER TABLE presentaciones_new RENAME TO presentaciones`);
    }

    async cleanupOrphanRows() {
        // Antes de activar claves foráneas, se limpian vínculos imposibles que venían de schemas antiguos.
        await this.run(`DELETE FROM presentaciones_producto WHERE producto_id NOT IN (SELECT id FROM productos)`);
        await this.run(`DELETE FROM presentaciones_producto WHERE presentacion_id NOT IN (SELECT id FROM presentaciones)`);
        await this.run(`UPDATE pedido_productos SET presentacion_id = NULL WHERE presentacion_id IS NOT NULL AND presentacion_id NOT IN (SELECT id FROM presentaciones)`);
        await this.run(`DELETE FROM pedido_productos WHERE pedido_id NOT IN (SELECT id FROM pedidos)`);
        await this.run(`DELETE FROM pedido_productos WHERE producto_id NOT IN (SELECT id FROM productos)`);
        await this.run(`DELETE FROM pagos WHERE pedido_id NOT IN (SELECT id FROM pedidos)`);
        await this.run(`DELETE FROM pedidos WHERE mesa_id NOT IN (SELECT id FROM mesas) OR usuario_id NOT IN (SELECT id FROM usuarios)`);
        await this.run(`DELETE FROM pedido_productos WHERE pedido_id NOT IN (SELECT id FROM pedidos)`);
        await this.run(`DELETE FROM pagos WHERE pedido_id NOT IN (SELECT id FROM pedidos)`);
        await this.run(`UPDATE comandas SET mesa_id = NULL WHERE mesa_id IS NOT NULL AND mesa_id NOT IN (SELECT id FROM mesas)`);
        await this.run(`UPDATE comandas SET pedido_id = NULL WHERE pedido_id IS NOT NULL AND pedido_id NOT IN (SELECT id FROM pedidos)`);
        await this.run(`UPDATE comandas SET usuario_solicitante_id = NULL WHERE usuario_solicitante_id IS NOT NULL AND usuario_solicitante_id NOT IN (SELECT id FROM usuarios)`);
        if (await this.tableExists('comanda_items')) {
            await this.run(`UPDATE comanda_items SET pedido_producto_id = NULL WHERE pedido_producto_id IS NOT NULL AND pedido_producto_id NOT IN (SELECT id FROM pedido_productos)`);
            await this.run(`UPDATE comanda_items SET producto_id = NULL WHERE producto_id IS NOT NULL AND producto_id NOT IN (SELECT id FROM productos)`);
            await this.run(`UPDATE comanda_items SET presentacion_id = NULL WHERE presentacion_id IS NOT NULL AND presentacion_id NOT IN (SELECT id FROM presentaciones)`);
            await this.run(`UPDATE comanda_items SET usuario_solicitante_id = NULL WHERE usuario_solicitante_id IS NOT NULL AND usuario_solicitante_id NOT IN (SELECT id FROM usuarios)`);
        }
        if (await this.tableExists('solicitudes_kitchen')) {
            await this.run(`UPDATE solicitudes_kitchen SET pedido_id = NULL WHERE pedido_id IS NOT NULL AND pedido_id NOT IN (SELECT id FROM pedidos)`);
        }
        await this.run(`UPDATE creditos SET cuenta_id = NULL WHERE cuenta_id IS NOT NULL AND cuenta_id NOT IN (SELECT id FROM cuentas_credito)`);
        await this.run(`UPDATE cuentas_credito SET pedido_id = NULL WHERE pedido_id IS NOT NULL AND pedido_id NOT IN (SELECT id FROM pedidos)`);
        await this.run(`UPDATE historial_transacciones SET usuario_id = NULL WHERE usuario_id IS NOT NULL AND usuario_id NOT IN (SELECT id FROM usuarios)`);
        await this.run(`DELETE FROM usuario_roles_trabajo WHERE usuario_id NOT IN (SELECT id FROM usuarios)`);
        await this.run(`DELETE FROM usuario_roles_trabajo WHERE rol_trabajo_id NOT IN (SELECT id FROM roles_trabajo)`);
        await this.run(`DELETE FROM mesa_responsables WHERE mesa_id NOT IN (SELECT id FROM mesas)`);
        await this.run(`DELETE FROM mesa_responsables WHERE usuario_id NOT IN (SELECT id FROM usuarios)`);
        await this.run(`UPDATE mesa_responsables SET rol_trabajo_id = NULL WHERE rol_trabajo_id IS NOT NULL AND rol_trabajo_id NOT IN (SELECT id FROM roles_trabajo)`);
        await this.run(`UPDATE mesa_responsables SET asignado_por_usuario_id = NULL WHERE asignado_por_usuario_id IS NOT NULL AND asignado_por_usuario_id NOT IN (SELECT id FROM usuarios)`);
        await this.run(`UPDATE pedidos SET rol_trabajo_id = NULL WHERE rol_trabajo_id IS NOT NULL AND rol_trabajo_id NOT IN (SELECT id FROM roles_trabajo)`);
        if (await this.tableExists('cuenta_responsables')) {
            await this.run(`DELETE FROM cuenta_responsables WHERE pedido_id NOT IN (SELECT id FROM pedidos)`);
            await this.run(`UPDATE cuenta_responsables SET usuario_id = NULL WHERE usuario_id IS NOT NULL AND usuario_id NOT IN (SELECT id FROM usuarios)`);
            await this.run(`UPDATE cuenta_responsables SET rol_trabajo_id = NULL WHERE rol_trabajo_id IS NOT NULL AND rol_trabajo_id NOT IN (SELECT id FROM roles_trabajo)`);
        }
        if (await this.tableExists('prefacturas')) {
            await this.run(`DELETE FROM prefacturas WHERE pedido_id NOT IN (SELECT id FROM pedidos)`);
            await this.run(`UPDATE prefacturas SET emitida_por_usuario_id = NULL WHERE emitida_por_usuario_id IS NOT NULL AND emitida_por_usuario_id NOT IN (SELECT id FROM usuarios)`);
            await this.run(`UPDATE prefacturas SET anulada_por_usuario_id = NULL WHERE anulada_por_usuario_id IS NOT NULL AND anulada_por_usuario_id NOT IN (SELECT id FROM usuarios)`);
        }
        if (await this.tableExists('prefactura_items')) {
            await this.run(`DELETE FROM prefactura_items WHERE prefactura_id NOT IN (SELECT id FROM prefacturas)`);
            await this.run(`DELETE FROM prefactura_items WHERE pedido_producto_id NOT IN (SELECT id FROM pedido_productos)`);
            await this.run(`DELETE FROM prefactura_items WHERE producto_id NOT IN (SELECT id FROM productos)`);
            await this.run(`UPDATE prefactura_items SET presentacion_id = NULL WHERE presentacion_id IS NOT NULL AND presentacion_id NOT IN (SELECT id FROM presentaciones)`);
        }
        if (await this.tableExists('historial_prefacturas')) {
            await this.run(`DELETE FROM historial_prefacturas WHERE prefactura_id NOT IN (SELECT id FROM prefacturas)`);
            await this.run(`UPDATE historial_prefacturas SET usuario_id = NULL WHERE usuario_id IS NOT NULL AND usuario_id NOT IN (SELECT id FROM usuarios)`);
        }
        if (await this.tableExists('pagos')) {
            await this.run(`UPDATE pagos SET prefactura_id = NULL WHERE prefactura_id IS NOT NULL AND prefactura_id NOT IN (SELECT id FROM prefacturas)`);
            await this.run(`UPDATE pagos SET cajero_usuario_id = NULL WHERE cajero_usuario_id IS NOT NULL AND cajero_usuario_id NOT IN (SELECT id FROM usuarios)`);
            await this.run(`UPDATE pagos SET anulado_por_usuario_id = NULL WHERE anulado_por_usuario_id IS NOT NULL AND anulado_por_usuario_id NOT IN (SELECT id FROM usuarios)`);
        }
        if (await this.tableExists('pago_componentes')) {
            await this.run(`DELETE FROM pago_componentes WHERE pago_id NOT IN (SELECT id FROM pagos)`);
        }
        if (await this.tableExists('pago_medios')) {
            await this.run(`DELETE FROM pago_medios WHERE pago_id NOT IN (SELECT id FROM pagos)`);
        }
        if (await this.tableExists('reversos_pago')) {
            await this.run(`DELETE FROM reversos_pago WHERE pago_id NOT IN (SELECT id FROM pagos)`);
            await this.run(`UPDATE reversos_pago SET usuario_id = NULL WHERE usuario_id IS NOT NULL AND usuario_id NOT IN (SELECT id FROM usuarios)`);
        }
    }

    shouldSeedDemoUser() {
        const value = String(process.env.SEED_DEMO_USER || '').trim().toLowerCase();
        return ['true', '1', 'yes', 'on'].includes(value);
    }

    normalizeDynamicSlug(value, fallback = 'zona') {
        const rawValue = String(value || fallback).trim().toLowerCase();
        const normalized = rawValue
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/ñ/g, 'n')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');

        return normalized || fallback;
    }

    titleFromSlug(slug, fallback = 'Zona') {
        return String(slug || fallback)
            .split('-')
            .filter(Boolean)
            .map(part => part.charAt(0).toUpperCase() + part.slice(1))
            .join(' ') || fallback;
    }

    legacyZoneSlugForSeat(row = {}) {
        const zona = this.normalizeDynamicSlug(row.zona || 'salon', 'salon');
        const tipo = this.normalizeDynamicSlug(row.tipo_asiento || 'mesa', 'mesa');

        if (zona === 'bar' && tipo === 'banco') return 'barra';
        if (zona === 'barra') return 'barra';
        return zona;
    }

    legacySeatTypeSlug(row = {}) {
        return this.normalizeDynamicSlug(row.tipo_asiento || 'mesa', 'mesa');
    }

    async upsertDynamicZone({ nombre, slug, icono, color, orden, acepta_reservas, aplica_servicio, porcentaje_servicio, visible_dashboard, activa }) {
        await this.run(`
            INSERT INTO zonas (
                nombre, slug, icono, color, orden,
                acepta_reservas, aplica_servicio, porcentaje_servicio,
                visible_dashboard, activa, creado_en, actualizado_en
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(slug) DO UPDATE SET
                nombre = excluded.nombre,
                icono = COALESCE(NULLIF(zonas.icono, ''), excluded.icono),
                color = COALESCE(NULLIF(zonas.color, ''), excluded.color),
                orden = CASE WHEN zonas.orden IS NULL OR zonas.orden = 0 THEN excluded.orden ELSE zonas.orden END,
                actualizado_en = excluded.actualizado_en
        `, [
            nombre,
            slug,
            icono || null,
            color || null,
            Number.isFinite(Number(orden)) ? Number(orden) : 0,
            acepta_reservas ? 1 : 0,
            aplica_servicio ? 1 : 0,
            Number.isFinite(Number(porcentaje_servicio)) ? Number(porcentaje_servicio) : 10,
            visible_dashboard === false ? 0 : 1,
            activa === false ? 0 : 1,
            new Date().toISOString(),
            new Date().toISOString()
        ]);
    }

    async upsertDynamicSeatType({ nombre, slug, icono, orden, activo }) {
        await this.run(`
            INSERT INTO tipos_puesto (nombre, slug, icono, orden, activo, creado_en, actualizado_en)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(slug) DO UPDATE SET
                nombre = excluded.nombre,
                icono = COALESCE(NULLIF(tipos_puesto.icono, ''), excluded.icono),
                orden = CASE WHEN tipos_puesto.orden IS NULL OR tipos_puesto.orden = 0 THEN excluded.orden ELSE tipos_puesto.orden END,
                actualizado_en = excluded.actualizado_en
        `, [
            nombre,
            slug,
            icono || null,
            Number.isFinite(Number(orden)) ? Number(orden) : 0,
            activo === false ? 0 : 1,
            new Date().toISOString(),
            new Date().toISOString()
        ]);
    }

    async ensureDefaultDynamicZonesAndTypes() {
        const defaultZones = [
            {
                nombre: 'Salón',
                slug: 'salon',
                icono: 'fa-chair',
                color: '#2ecc71',
                orden: 1,
                acepta_reservas: true,
                aplica_servicio: true,
                porcentaje_servicio: 10,
                visible_dashboard: true,
                activa: true
            },
            {
                nombre: 'Bar',
                slug: 'bar',
                icono: 'fa-martini-glass-citrus',
                color: '#3498db',
                orden: 2,
                acepta_reservas: true,
                aplica_servicio: false,
                porcentaje_servicio: 10,
                visible_dashboard: true,
                activa: true
            },
            {
                nombre: 'Barra',
                slug: 'barra',
                icono: 'fa-grip-lines',
                color: '#f39c12',
                orden: 3,
                acepta_reservas: false,
                aplica_servicio: false,
                porcentaje_servicio: 10,
                visible_dashboard: true,
                activa: true
            }
        ];

        const defaultSeatTypes = [
            { nombre: 'Mesa', slug: 'mesa', icono: 'fa-chair', orden: 1, activo: true },
            { nombre: 'Banco', slug: 'banco', icono: 'fa-grip-lines', orden: 2, activo: true }
        ];

        for (const zone of defaultZones) {
            await this.upsertDynamicZone(zone);
        }

        for (const seatType of defaultSeatTypes) {
            await this.upsertDynamicSeatType(seatType);
        }
    }

    async ensureZonesFromLegacySeats() {
        const rows = await this.all(`
            SELECT DISTINCT
                COALESCE(NULLIF(zona, ''), 'salon') AS zona,
                COALESCE(NULLIF(tipo_asiento, ''), 'mesa') AS tipo_asiento
            FROM mesas
        `);

        const existingSlugs = new Set((await this.all('SELECT slug FROM zonas')).map(row => row.slug));
        let nextOrderRow = await this.get('SELECT COALESCE(MAX(orden), 0) + 1 AS nextOrder FROM zonas');
        let nextOrder = Number(nextOrderRow?.nextOrder || 1);

        for (const row of rows) {
            const slug = this.legacyZoneSlugForSeat(row);
            if (existingSlugs.has(slug)) continue;

            await this.upsertDynamicZone({
                nombre: this.titleFromSlug(slug, 'Zona'),
                slug,
                icono: 'fa-location-dot',
                color: '#95a5a6',
                orden: nextOrder,
                acepta_reservas: true,
                aplica_servicio: false,
                porcentaje_servicio: 10,
                visible_dashboard: true,
                activa: true
            });
            existingSlugs.add(slug);
            nextOrder += 1;
        }
    }

    async ensureSeatTypesFromLegacySeats() {
        const rows = await this.all(`
            SELECT DISTINCT COALESCE(NULLIF(tipo_asiento, ''), 'mesa') AS tipo_asiento
            FROM mesas
        `);

        const existingSlugs = new Set((await this.all('SELECT slug FROM tipos_puesto')).map(row => row.slug));
        let nextOrderRow = await this.get('SELECT COALESCE(MAX(orden), 0) + 1 AS nextOrder FROM tipos_puesto');
        let nextOrder = Number(nextOrderRow?.nextOrder || 1);

        for (const row of rows) {
            const slug = this.legacySeatTypeSlug(row);
            if (existingSlugs.has(slug)) continue;

            await this.upsertDynamicSeatType({
                nombre: this.titleFromSlug(slug, 'Puesto'),
                slug,
                icono: 'fa-chair',
                orden: nextOrder,
                activo: true
            });
            existingSlugs.add(slug);
            nextOrder += 1;
        }
    }

    async backfillDynamicSeatLinks() {
        const zonas = await this.all('SELECT id, slug FROM zonas');
        const tipos = await this.all('SELECT id, slug FROM tipos_puesto');
        const zonaBySlug = new Map(zonas.map(row => [row.slug, row.id]));
        const tipoBySlug = new Map(tipos.map(row => [row.slug, row.id]));
        const seats = await this.all('SELECT id, zona, tipo_asiento FROM mesas');

        for (const seat of seats) {
            const zoneSlug = this.legacyZoneSlugForSeat(seat);
            const typeSlug = this.legacySeatTypeSlug(seat);
            const zonaId = zonaBySlug.get(zoneSlug) || null;
            const tipoPuestoId = tipoBySlug.get(typeSlug) || null;

            await this.run(`
                UPDATE mesas
                SET zona_id = ?,
                    tipo_puesto_id = ?,
                    nombre_visible = COALESCE(NULLIF(nombre_visible, ''), NULL),
                    activo = COALESCE(activo, 1)
                WHERE id = ?
            `, [zonaId, tipoPuestoId, seat.id]);
        }
    }


    async backfillOrderServiceTotals() {
        const columns = await this.getColumns('pedidos');
        if (!columns.includes('monto_servicio') || !columns.includes('total_con_servicio')) return;

        await this.run(`
            UPDATE pedidos
            SET monto_servicio = COALESCE(monto_servicio, 0),
                total_con_servicio = COALESCE(total_con_servicio, total + COALESCE(monto_servicio, 0))
            WHERE total_con_servicio IS NULL
               OR monto_servicio IS NULL
        `);
    }

    async ensureMesaResponsibilityConsistency() {
        // Compatibilidad: las cuentas pendientes antiguas se enlazan al usuario que creó el pedido
        // solo cuando la mesa activa todavía no tiene responsables asignados.
        const pendingRows = await this.all(`
            SELECT
                p.id AS pedido_id,
                p.mesa_id,
                p.usuario_id,
                p.rol_trabajo_id,
                m.estado
            FROM pedidos p
            INNER JOIN mesas m ON m.id = p.mesa_id
            WHERE p.estado = 'pendiente'
              AND COALESCE(m.activo, 1) = 1
              AND m.estado IN ('ocupada', 'reservada')
              AND p.usuario_id IS NOT NULL
              AND NOT EXISTS (
                  SELECT 1 FROM mesa_responsables mr WHERE mr.mesa_id = p.mesa_id
              )
        `);

        for (const row of pendingRows) {
            await this.run(`
                INSERT OR IGNORE INTO mesa_responsables (
                    mesa_id, usuario_id, rol_trabajo_id, asignado_por_usuario_id, fecha_asignacion
                ) VALUES (?, ?, ?, ?, ?)
            `, [row.mesa_id, row.usuario_id, row.rol_trabajo_id || null, row.usuario_id, new Date().toISOString()]);
        }

        // Las mesas libres no deben conservar responsables operativos activos.
        await this.run(`
            DELETE FROM mesa_responsables
            WHERE mesa_id IN (
                SELECT id FROM mesas WHERE estado = 'libre' OR COALESCE(activo, 1) = 0
            )
        `);
    }

    async ensureDynamicModelConsistency() {
        await this.ensureDefaultDynamicZonesAndTypes();
        await this.ensureZonesFromLegacySeats();
        await this.ensureSeatTypesFromLegacySeats();
        await this.backfillDynamicSeatLinks();
        await this.ensureMesaResponsibilityConsistency();

        const report = await this.getDynamicModelCompatibilityReport();
        if (!report.ok) {
            console.warn('Advertencia: compatibilidad de zonas/puestos requiere revisión:', report.summary);
        }
    }

    async getDynamicModelCompatibilityReport() {
        const summary = await this.get(`
            SELECT
                COUNT(*) AS total_puestos,
                SUM(CASE WHEN m.zona_id IS NULL THEN 1 ELSE 0 END) AS sin_zona_id,
                SUM(CASE WHEN m.tipo_puesto_id IS NULL THEN 1 ELSE 0 END) AS sin_tipo_puesto_id,
                SUM(CASE WHEN m.zona_id IS NOT NULL AND z.id IS NULL THEN 1 ELSE 0 END) AS zona_id_inexistente,
                SUM(CASE WHEN m.tipo_puesto_id IS NOT NULL AND tp.id IS NULL THEN 1 ELSE 0 END) AS tipo_puesto_id_inexistente,
                SUM(CASE WHEN COALESCE(m.activo, 1) = 1 THEN 1 ELSE 0 END) AS puestos_activos
            FROM mesas m
            LEFT JOIN zonas z ON z.id = m.zona_id
            LEFT JOIN tipos_puesto tp ON tp.id = m.tipo_puesto_id
        `);

        const zonas = await this.all(`
            SELECT
                z.id,
                z.nombre,
                z.slug,
                z.activa,
                COUNT(m.id) AS puestos_total
            FROM zonas z
            LEFT JOIN mesas m ON m.zona_id = z.id
            GROUP BY z.id
            ORDER BY z.orden ASC, z.nombre ASC
        `);

        const tiposPuesto = await this.all(`
            SELECT
                tp.id,
                tp.nombre,
                tp.slug,
                tp.activo,
                COUNT(m.id) AS puestos_total
            FROM tipos_puesto tp
            LEFT JOIN mesas m ON m.tipo_puesto_id = tp.id
            GROUP BY tp.id
            ORDER BY tp.orden ASC, tp.nombre ASC
        `);

        const sampleIssues = await this.all(`
            SELECT
                m.id,
                m.numero,
                m.zona,
                m.tipo_asiento,
                m.zona_id,
                m.tipo_puesto_id
            FROM mesas m
            LEFT JOIN zonas z ON z.id = m.zona_id
            LEFT JOIN tipos_puesto tp ON tp.id = m.tipo_puesto_id
            WHERE m.zona_id IS NULL
               OR m.tipo_puesto_id IS NULL
               OR (m.zona_id IS NOT NULL AND z.id IS NULL)
               OR (m.tipo_puesto_id IS NOT NULL AND tp.id IS NULL)
            ORDER BY m.id ASC
            LIMIT 20
        `);

        const normalizedSummary = {
            total_puestos: Number(summary?.total_puestos || 0),
            puestos_activos: Number(summary?.puestos_activos || 0),
            sin_zona_id: Number(summary?.sin_zona_id || 0),
            sin_tipo_puesto_id: Number(summary?.sin_tipo_puesto_id || 0),
            zona_id_inexistente: Number(summary?.zona_id_inexistente || 0),
            tipo_puesto_id_inexistente: Number(summary?.tipo_puesto_id_inexistente || 0)
        };

        const ok = normalizedSummary.sin_zona_id === 0
            && normalizedSummary.sin_tipo_puesto_id === 0
            && normalizedSummary.zona_id_inexistente === 0
            && normalizedSummary.tipo_puesto_id_inexistente === 0;

        return {
            ok,
            summary: normalizedSummary,
            zonas,
            tipos_puesto: tiposPuesto,
            sample_issues: sampleIssues
        };
    }

    async replaceRoleCapabilities(roleId, capabilityCodes = []) {
        await this.run('DELETE FROM rol_trabajo_capacidades WHERE rol_trabajo_id = ?', [roleId]);

        for (const code of [...new Set(capabilityCodes)]) {
            await this.run(`
                INSERT OR IGNORE INTO rol_trabajo_capacidades (rol_trabajo_id, capacidad_id, creado_en)
                SELECT ?, id, ? FROM capacidades WHERE codigo = ? AND activa = 1
            `, [roleId, new Date().toISOString(), code]);
        }
    }

    async ensureCapabilitiesAndCashierRole() {
        const now = new Date().toISOString();

        for (const capability of CAPABILITY_DEFINITIONS) {
            await this.run(`
                INSERT INTO capacidades (codigo, nombre, descripcion, categoria, activa, creado_en, actualizado_en)
                VALUES (?, ?, ?, ?, 1, ?, ?)
                ON CONFLICT(codigo) DO UPDATE SET
                    nombre = excluded.nombre,
                    descripcion = excluded.descripcion,
                    categoria = excluded.categoria,
                    activa = 1,
                    actualizado_en = excluded.actualizado_en
            `, [capability.code, capability.name, capability.description, capability.category, now, now]);
        }

        let cashierRole = await this.get("SELECT id FROM roles_trabajo WHERE slug = 'cajero'");
        if (!cashierRole) {
            const result = await this.run(`
                INSERT INTO roles_trabajo (nombre, slug, descripcion, activo, requiere_zona, es_sistema, destino_inicial, creado_en, actualizado_en)
                VALUES ('Cajero', 'cajero', 'Cobro de prefacturas y operación de Caja sin obligación de zona.', 1, 0, 1, 'cash', ?, ?)
            `, [now, now]);
            cashierRole = { id: result.id };
        } else {
            await this.run(`
                UPDATE roles_trabajo
                SET requiere_zona = 0, es_sistema = 1, destino_inicial = 'cash', activo = 1, actualizado_en = ?
                WHERE id = ?
            `, [now, cashierRole.id]);
        }

        for (const code of CASHIER_CAPABILITIES) {
            await this.run(`
                INSERT OR IGNORE INTO rol_trabajo_capacidades (rol_trabajo_id, capacidad_id, creado_en)
                SELECT ?, id, ? FROM capacidades WHERE codigo = ? AND activa = 1
            `, [cashierRole.id, now, code]);
        }

        const backfillMarker = await this.get("SELECT valor FROM configuracion WHERE clave = 'v3_capability_backfill_done'");
        if (!backfillMarker) {
            const legacyRoles = await this.all("SELECT id FROM roles_trabajo WHERE id != ? AND COALESCE(requiere_zona, 1) = 1", [cashierRole.id]);
            for (const role of legacyRoles) {
                await this.replaceRoleCapabilities(role.id, LEGACY_ROLE_BACKFILL);
            }
            await this.run(`
                INSERT OR REPLACE INTO configuracion (clave, valor, version_app) VALUES (?, ?, ?)
            `, ['v3_capability_backfill_done', now, APP_VERSION]);
        }
    }

    async insertInitialData() {
        await this.ensureCapabilitiesAndCashierRole();

        const userCount = await this.get('SELECT COUNT(*) as count FROM usuarios');
        if ((!userCount || userCount.count === 0) && this.shouldSeedDemoUser()) {
            const hashedPassword = await bcrypt.hash('admin123', 10);
            await this.run(
                'INSERT INTO usuarios (nombre, password, tipo, activo, fecha_creacion) VALUES (?, ?, ?, ?, ?)',
                ['admin', hashedPassword, 'administrador', 1, new Date().toISOString()]
            );
            console.log('Usuario administrador demo creado por SEED_DEMO_USER=true: admin / admin123');
        }

        const categoryCount = await this.get('SELECT COUNT(*) as count FROM categorias');
        if (!categoryCount || categoryCount.count === 0) {
            await this.run('INSERT INTO categorias (nombre, parent_id, permite_cocina) VALUES (?, ?, ?)', ['Alimentos', null, 1]);
            await this.run('INSERT INTO categorias (nombre, parent_id, permite_cocina) VALUES (?, ?, ?)', ['Bebidas', null, 0]);
            await this.run('INSERT INTO categorias (nombre, parent_id, permite_cocina) VALUES (?, ?, ?)', ['Entradas', null, 0]);

            const alimentos = await this.get('SELECT id FROM categorias WHERE nombre = ?', ['Alimentos']);
            const bebidas = await this.get('SELECT id FROM categorias WHERE nombre = ?', ['Bebidas']);

            await this.run('INSERT INTO categorias (nombre, parent_id, permite_cocina) VALUES (?, ?, ?)', ['Preparados', alimentos.id, 1]);
            await this.run('INSERT INTO categorias (nombre, parent_id, permite_cocina) VALUES (?, ?, ?)', ['Fríos', alimentos.id, 0]);
            await this.run('INSERT INTO categorias (nombre, parent_id, permite_cocina) VALUES (?, ?, ?)', ['Cervezas', bebidas.id, 0]);
            await this.run('INSERT INTO categorias (nombre, parent_id, permite_cocina) VALUES (?, ?, ?)', ['Gaseosas', bebidas.id, 0]);
        }

        const mesaCount = await this.get('SELECT COUNT(*) as count FROM mesas');
        if (!mesaCount || mesaCount.count === 0) {
            for (let i = 1; i <= 10; i++) {
                await this.run(
                    'INSERT INTO mesas (numero, capacidad, estado, zona, tipo_asiento) VALUES (?, ?, ?, ?, ?)',
                    [i, 4, 'libre', 'salon', 'mesa']
                );
            }
        }

        const defaultConfig = {
            nombre_restaurante: 'Mi Restaurante',
            direccion: 'Calle Principal 123',
            telefono: '+1234567890',
            moneda: '₡',
            version_app: APP_VERSION
        };

        for (const [clave, valor] of Object.entries(defaultConfig)) {
            await this.run(
                'INSERT OR IGNORE INTO configuracion (clave, valor, version_app) VALUES (?, ?, ?)',
                [clave, valor, APP_VERSION]
            );
        }

        await this.run(
            "UPDATE configuracion SET valor = ?, version_app = ? WHERE clave = 'version_app'",
            [APP_VERSION, APP_VERSION]
        );
    }

    async tableExists(tableName) {
        const row = await this.get(
            "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
            [tableName]
        );
        return !!row;
    }

    async getColumns(tableName) {
        const rows = await this.all(`PRAGMA table_info(${tableName})`);
        return rows.map(row => row.name);
    }

    async ensureColumn(tableName, columnName, definition) {
        const exists = await this.tableExists(tableName);
        if (!exists) return;

        const columns = await this.getColumns(tableName);
        if (!columns.includes(columnName)) {
            await this.run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
        }
    }

    getActiveConnection() {
        return this.transactionStorage.getStore()?.connection || this.db;
    }

    rawRun(connection, sql, params = []) {
        return new Promise((resolve, reject) => {
            connection.run(sql, params, function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ id: this.lastID, lastID: this.lastID, changes: this.changes });
                }
            });
        });
    }

    rawGet(connection, sql, params = []) {
        return new Promise((resolve, reject) => {
            connection.get(sql, params, (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    rawAll(connection, sql, params = []) {
        return new Promise((resolve, reject) => {
            connection.all(sql, params, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    openConnection() {
        return new Promise((resolve, reject) => {
            const connection = new sqlite3.Database(this.dbPath, async (err) => {
                if (err) {
                    reject(err);
                    return;
                }

                try {
                    await this.rawRun(connection, 'PRAGMA busy_timeout = 5000');
                    await this.rawRun(connection, 'PRAGMA foreign_keys = ON');
                    resolve(connection);
                } catch (error) {
                    connection.close(() => reject(error));
                }
            });
        });
    }

    closeConnection(connection) {
        return new Promise((resolve, reject) => {
            connection.close((err) => err ? reject(err) : resolve());
        });
    }

    createTransactionClient(connection, callbacks) {
        return {
            run: (sql, params = []) => this.rawRun(connection, sql, params),
            get: (sql, params = []) => this.rawGet(connection, sql, params),
            all: (sql, params = []) => this.rawAll(connection, sql, params),
            afterCommit: (callback) => {
                if (typeof callback !== 'function') {
                    throw new TypeError('afterCommit requiere una función');
                }
                callbacks.afterCommit.push(callback);
            },
            afterRollback: (callback) => {
                if (typeof callback !== 'function') {
                    throw new TypeError('afterRollback requiere una función');
                }
                callbacks.afterRollback.push(callback);
            }
        };
    }

    async runNestedTransaction(work, store) {
        const savepoint = `sp_${++this.savepointCounter}`;
        const commitCallbackStart = store.callbacks.afterCommit.length;
        const rollbackCallbackStart = store.callbacks.afterRollback.length;
        await this.rawRun(store.connection, `SAVEPOINT ${savepoint}`);

        try {
            const result = await work(store.client);
            await this.rawRun(store.connection, `RELEASE SAVEPOINT ${savepoint}`);
            return result;
        } catch (error) {
            await this.rawRun(store.connection, `ROLLBACK TO SAVEPOINT ${savepoint}`);
            await this.rawRun(store.connection, `RELEASE SAVEPOINT ${savepoint}`);

            const nestedRollbackCallbacks = store.callbacks.afterRollback.slice(rollbackCallbackStart);
            store.callbacks.afterCommit.length = commitCallbackStart;
            store.callbacks.afterRollback.length = rollbackCallbackStart;

            for (const callback of nestedRollbackCallbacks) {
                try {
                    await callback(error);
                } catch (callbackError) {
                    error.afterRollbackError = callbackError;
                }
            }

            throw error;
        }
    }

    withTransaction(work, options = {}) {
        if (typeof work !== 'function') {
            return Promise.reject(new TypeError('withTransaction requiere una función'));
        }

        const activeStore = this.transactionStorage.getStore();
        if (activeStore) {
            return this.runNestedTransaction(work, activeStore);
        }

        const mode = String(options.mode || 'IMMEDIATE').toUpperCase();
        if (!['DEFERRED', 'IMMEDIATE', 'EXCLUSIVE'].includes(mode)) {
            return Promise.reject(new TypeError(`Modo de transacción no soportado: ${mode}`));
        }

        const executeCore = async () => {
            const connection = await this.openConnection();
            const callbacks = { afterCommit: [], afterRollback: [] };
            const client = this.createTransactionClient(connection, callbacks);
            let result;
            let transactionError = null;

            try {
                await this.rawRun(connection, `BEGIN ${mode}`);
                result = await this.transactionStorage.run(
                    { connection, client, callbacks },
                    () => work(client)
                );
                await this.rawRun(connection, 'COMMIT');
            } catch (error) {
                transactionError = error;
                try {
                    await this.rawRun(connection, 'ROLLBACK');
                } catch (rollbackError) {
                    transactionError.rollbackError = rollbackError;
                }
            } finally {
                await this.closeConnection(connection);
            }

            return { result, transactionError, callbacks };
        };

        const queuedCore = this.transactionQueue.then(executeCore, executeCore);
        this.transactionQueue = queuedCore.then(() => undefined, () => undefined);

        return queuedCore.then(async ({ result, transactionError, callbacks }) => {
            if (transactionError) {
                for (const callback of callbacks.afterRollback) {
                    try {
                        await callback(transactionError);
                    } catch (callbackError) {
                        transactionError.afterRollbackError = callbackError;
                    }
                }
                throw transactionError;
            }

            for (const callback of callbacks.afterCommit) {
                await callback();
            }

            return result;
        });
    }

    run(sql, params = []) {
        const connection = this.getActiveConnection();
        if (!connection) {
            return Promise.reject(new Error('La base de datos no está conectada'));
        }
        return this.rawRun(connection, sql, params);
    }

    get(sql, params = []) {
        const connection = this.getActiveConnection();
        if (!connection) {
            return Promise.reject(new Error('La base de datos no está conectada'));
        }
        return this.rawGet(connection, sql, params);
    }

    all(sql, params = []) {
        const connection = this.getActiveConnection();
        if (!connection) {
            return Promise.reject(new Error('La base de datos no está conectada'));
        }
        return this.rawAll(connection, sql, params);
    }

    close() {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                resolve();
                return;
            }

            this.db.close((err) => {
                if (err) {
                    reject(err);
                } else {
                    this.db = null;
                    resolve();
                }
            });
        });
    }
}

const database = new Database();
module.exports = database;
module.exports.Database = Database;
