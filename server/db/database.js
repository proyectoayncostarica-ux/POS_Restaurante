const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { APP_VERSION } = require('../config/appInfo');

const DEFAULT_DB_PATH = path.join(__dirname, '../../data/restaurant.db');
const DB_PATH = process.env.DB_PATH
    ? path.resolve(process.cwd(), process.env.DB_PATH)
    : DEFAULT_DB_PATH;

class Database {
    constructor() {
        this.db = null;
    }

    connect() {
        return new Promise((resolve, reject) => {
            const dataDir = path.dirname(DB_PATH);
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }

            this.db = new sqlite3.Database(DB_PATH, async (err) => {
                if (err) {
                    console.error('Error al conectar con la base de datos:', err);
                    reject(err);
                    return;
                }

                try {
                    await this.run('PRAGMA journal_mode = WAL');
                    await this.run('PRAGMA busy_timeout = 5000');
                    console.log(`Conectado a la base de datos SQLite: ${DB_PATH}`);
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
                creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                actualizado_en TEXT
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
                FOREIGN KEY (parent_id) REFERENCES categorias (id) ON DELETE RESTRICT
            )`,

            `CREATE TABLE IF NOT EXISTS productos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nombre TEXT NOT NULL,
                descripcion TEXT,
                precio REAL NOT NULL DEFAULT 0,
                categoria_id INTEGER NOT NULL,
                subcategoria_id INTEGER,
                es_cocina INTEGER NOT NULL DEFAULT 0,
                imagen TEXT,
                FOREIGN KEY (categoria_id) REFERENCES categorias (id) ON DELETE RESTRICT,
                FOREIGN KEY (subcategoria_id) REFERENCES categorias (id) ON DELETE SET NULL
            )`,

            `CREATE TABLE IF NOT EXISTS presentaciones (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nombre TEXT NOT NULL UNIQUE,
                tipo TEXT DEFAULT 'tamaño',
                cantidad TEXT,
                activo INTEGER NOT NULL DEFAULT 1,
                creado_en TEXT,
                actualizado_en TEXT
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
                fecha TEXT NOT NULL,
                estado TEXT NOT NULL CHECK(estado IN ('pendiente', 'pagado', 'cancelado', 'credito')),
                total REAL NOT NULL DEFAULT 0,
                cliente_nombre TEXT,
                FOREIGN KEY (mesa_id) REFERENCES mesas (id) ON DELETE RESTRICT,
                FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE RESTRICT
            )`,

            `CREATE TABLE IF NOT EXISTS pedido_productos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                pedido_id INTEGER NOT NULL,
                producto_id INTEGER NOT NULL,
                cantidad INTEGER NOT NULL,
                precio_unitario REAL NOT NULL,
                precio_original REAL NOT NULL,
                creado_en TEXT DEFAULT CURRENT_TIMESTAMP,
                presentacion_id INTEGER,
                FOREIGN KEY (pedido_id) REFERENCES pedidos (id) ON DELETE CASCADE,
                FOREIGN KEY (producto_id) REFERENCES productos (id) ON DELETE RESTRICT,
                FOREIGN KEY (presentacion_id) REFERENCES presentaciones (id) ON DELETE SET NULL
            )`,

            `CREATE TABLE IF NOT EXISTS pagos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                pedido_id INTEGER NOT NULL,
                metodo_pago TEXT NOT NULL CHECK(metodo_pago IN ('efectivo', 'tarjeta', 'credito')),
                monto REAL NOT NULL,
                fecha TEXT NOT NULL,
                FOREIGN KEY (pedido_id) REFERENCES pedidos (id) ON DELETE CASCADE
            )`,

            `CREATE TABLE IF NOT EXISTS cuentas_credito (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cliente_nombre TEXT NOT NULL,
                monto_total REAL NOT NULL,
                fecha TEXT NOT NULL,
                pedido_id INTEGER,
                usuario_origen TEXT,
                autorizado_por TEXT,
                mesa TEXT,
                FOREIGN KEY (pedido_id) REFERENCES pedidos (id) ON DELETE SET NULL
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
                mesa_id INTEGER NOT NULL,
                productos_cocina TEXT NOT NULL,
                fecha_impresion TEXT NOT NULL,
                estado TEXT NOT NULL CHECK(estado IN ('pendiente', 'impresa', 'entregada')),
                FOREIGN KEY (mesa_id) REFERENCES mesas (id) ON DELETE CASCADE
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

        await this.createIndexes();
        console.log('Tablas base verificadas correctamente');
    }

    async createIndexes() {
        const indexes = [
            'CREATE INDEX IF NOT EXISTS idx_pedidos_estado ON pedidos(estado)',
            'CREATE INDEX IF NOT EXISTS idx_pedidos_fecha ON pedidos(fecha)',
            'CREATE INDEX IF NOT EXISTS idx_pedidos_mesa ON pedidos(mesa_id)',
            'CREATE INDEX IF NOT EXISTS idx_pedido_productos_pedido ON pedido_productos(pedido_id)',
            'CREATE INDEX IF NOT EXISTS idx_pagos_pedido ON pagos(pedido_id)',
            'CREATE INDEX IF NOT EXISTS idx_mesas_estado ON mesas(estado)',
            'CREATE INDEX IF NOT EXISTS idx_zonas_slug ON zonas(slug)',
            'CREATE INDEX IF NOT EXISTS idx_tipos_puesto_slug ON tipos_puesto(slug)',
            'CREATE INDEX IF NOT EXISTS idx_roles_trabajo_slug ON roles_trabajo(slug)',
            'CREATE INDEX IF NOT EXISTS idx_rol_trabajo_zonas_zona ON rol_trabajo_zonas(zona_id)',
            'CREATE INDEX IF NOT EXISTS idx_usuario_roles_trabajo_usuario ON usuario_roles_trabajo(usuario_id)',
            'CREATE INDEX IF NOT EXISTS idx_usuario_roles_trabajo_rol ON usuario_roles_trabajo(rol_trabajo_id)',
            'CREATE INDEX IF NOT EXISTS idx_cuentas_credito_fecha ON cuentas_credito(fecha)',
            'CREATE INDEX IF NOT EXISTS idx_historial_fecha ON historial_transacciones(fecha)'
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

        await this.ensureColumn('mesas', 'zona', "TEXT NOT NULL DEFAULT 'salon'");
        await this.ensureColumn('mesas', 'tipo_asiento', "TEXT NOT NULL DEFAULT 'mesa'");
        await this.ensureColumn('mesas', 'zona_id', 'INTEGER');
        await this.ensureColumn('mesas', 'tipo_puesto_id', 'INTEGER');
        await this.ensureColumn('mesas', 'nombre_visible', 'TEXT');
        await this.ensureColumn('mesas', 'acepta_reservas_override', 'INTEGER');
        await this.ensureColumn('mesas', 'aplica_servicio_override', 'INTEGER');
        await this.ensureColumn('mesas', 'activo', 'INTEGER NOT NULL DEFAULT 1');
        await this.ensureColumn('mesas', 'cliente_nombre', 'TEXT');
        await this.ensureColumn('mesas', 'fecha_apertura', 'TEXT');
        await this.ensureColumn('mesas', 'cantidad_personas', 'INTEGER');
        await this.ensureColumn('mesas', 'hora_estimada', 'TEXT');
        await this.normalizeLegacyTableColumns();
        await this.createDynamicModelIndexes();

        await this.ensureColumn('productos', 'imagen', 'TEXT');
        await this.ensureColumn('presentaciones', 'tipo', "TEXT DEFAULT 'tamaño'");
        await this.ensureColumn('presentaciones', 'cantidad', 'TEXT');
        await this.ensureColumn('presentaciones', 'activo', 'INTEGER NOT NULL DEFAULT 1');
        await this.ensureColumn('presentaciones', 'creado_en', 'TEXT');
        await this.ensureColumn('presentaciones', 'actualizado_en', 'TEXT');
        await this.ensureColumn('presentaciones_producto', 'activo', 'INTEGER NOT NULL DEFAULT 1');
        await this.ensureColumn('presentaciones_producto', 'creado_en', 'TEXT DEFAULT CURRENT_TIMESTAMP');
        await this.ensureColumn('presentaciones_producto', 'actualizado_en', 'TEXT DEFAULT CURRENT_TIMESTAMP');
        await this.ensureColumn('presentaciones_producto', 'imagen', 'TEXT');

        await this.ensureColumn('pedidos', 'cliente_nombre', 'TEXT');
        await this.ensureColumn('pedido_productos', 'creado_en', 'TEXT DEFAULT CURRENT_TIMESTAMP');
        await this.ensureColumn('pedido_productos', 'presentacion_id', 'INTEGER');
        await this.ensureColumn('cuentas_credito', 'pedido_id', 'INTEGER');
        await this.ensureColumn('cuentas_credito', 'usuario_origen', 'TEXT');
        await this.ensureColumn('cuentas_credito', 'autorizado_por', 'TEXT');
        await this.ensureColumn('cuentas_credito', 'mesa', 'TEXT');
        await this.ensureColumn('configuracion', 'version_app', `TEXT DEFAULT '${APP_VERSION}'`);

        await this.rebuildLegacyForeignKeys();
        await this.cleanupOrphanRows();
        console.log('Migraciones de esquema aplicadas/verificadas');
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
        await this.rebuildTable('pedidos', `CREATE TABLE pedidos_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            mesa_id INTEGER NOT NULL,
            usuario_id INTEGER NOT NULL,
            fecha TEXT NOT NULL,
            estado TEXT NOT NULL CHECK(estado IN ('pendiente', 'pagado', 'cancelado', 'credito')),
            total REAL NOT NULL DEFAULT 0,
            cliente_nombre TEXT,
            FOREIGN KEY (mesa_id) REFERENCES mesas (id) ON DELETE RESTRICT,
            FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE RESTRICT
        )`, ['id', 'mesa_id', 'usuario_id', 'fecha', 'estado', 'total', 'cliente_nombre']);

        await this.rebuildTable('pedido_productos', `CREATE TABLE pedido_productos_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pedido_id INTEGER NOT NULL,
            producto_id INTEGER NOT NULL,
            cantidad INTEGER NOT NULL,
            precio_unitario REAL NOT NULL,
            precio_original REAL NOT NULL,
            creado_en TEXT DEFAULT CURRENT_TIMESTAMP,
            presentacion_id INTEGER,
            FOREIGN KEY (pedido_id) REFERENCES pedidos (id) ON DELETE CASCADE,
            FOREIGN KEY (producto_id) REFERENCES productos (id) ON DELETE RESTRICT,
            FOREIGN KEY (presentacion_id) REFERENCES presentaciones (id) ON DELETE SET NULL
        )`, ['id', 'pedido_id', 'producto_id', 'cantidad', 'precio_unitario', 'precio_original', 'creado_en', 'presentacion_id']);

        await this.rebuildTable('pagos', `CREATE TABLE pagos_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pedido_id INTEGER NOT NULL,
            metodo_pago TEXT NOT NULL CHECK(metodo_pago IN ('efectivo', 'tarjeta', 'credito')),
            monto REAL NOT NULL,
            fecha TEXT NOT NULL,
            FOREIGN KEY (pedido_id) REFERENCES pedidos (id) ON DELETE CASCADE
        )`, ['id', 'pedido_id', 'metodo_pago', 'monto', 'fecha']);

        await this.rebuildTable('cuentas_credito', `CREATE TABLE cuentas_credito_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cliente_nombre TEXT NOT NULL,
            monto_total REAL NOT NULL,
            fecha TEXT NOT NULL,
            pedido_id INTEGER,
            usuario_origen TEXT,
            autorizado_por TEXT,
            mesa TEXT,
            FOREIGN KEY (pedido_id) REFERENCES pedidos (id) ON DELETE SET NULL
        )`, ['id', 'cliente_nombre', 'monto_total', 'fecha', 'pedido_id', 'usuario_origen', 'autorizado_por', 'mesa']);

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
            mesa_id INTEGER NOT NULL,
            productos_cocina TEXT NOT NULL,
            fecha_impresion TEXT NOT NULL,
            estado TEXT NOT NULL CHECK(estado IN ('pendiente', 'impresa', 'entregada')),
            FOREIGN KEY (mesa_id) REFERENCES mesas (id) ON DELETE CASCADE
        )`, ['id', 'mesa_id', 'productos_cocina', 'fecha_impresion', 'estado']);
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
        await this.run(`DELETE FROM comandas WHERE mesa_id NOT IN (SELECT id FROM mesas)`);
        await this.run(`UPDATE creditos SET cuenta_id = NULL WHERE cuenta_id IS NOT NULL AND cuenta_id NOT IN (SELECT id FROM cuentas_credito)`);
        await this.run(`UPDATE cuentas_credito SET pedido_id = NULL WHERE pedido_id IS NOT NULL AND pedido_id NOT IN (SELECT id FROM pedidos)`);
        await this.run(`UPDATE historial_transacciones SET usuario_id = NULL WHERE usuario_id IS NOT NULL AND usuario_id NOT IN (SELECT id FROM usuarios)`);
        await this.run(`DELETE FROM usuario_roles_trabajo WHERE usuario_id NOT IN (SELECT id FROM usuarios)`);
        await this.run(`DELETE FROM usuario_roles_trabajo WHERE rol_trabajo_id NOT IN (SELECT id FROM roles_trabajo)`);
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

    async ensureDynamicModelConsistency() {
        await this.ensureDefaultDynamicZonesAndTypes();
        await this.ensureZonesFromLegacySeats();
        await this.ensureSeatTypesFromLegacySeats();
        await this.backfillDynamicSeatLinks();

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

    async insertInitialData() {
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

    run(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ id: this.lastID, lastID: this.lastID, changes: this.changes });
                }
            });
        });
    }

    get(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    all(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
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
