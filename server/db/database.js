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

            `CREATE TABLE IF NOT EXISTS mesas (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                numero INTEGER NOT NULL,
                capacidad INTEGER NOT NULL DEFAULT 4,
                estado TEXT NOT NULL DEFAULT 'libre' CHECK(estado IN ('libre', 'ocupada', 'reservada')),
                zona TEXT NOT NULL DEFAULT 'salon',
                tipo_asiento TEXT NOT NULL DEFAULT 'mesa',
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
            'CREATE INDEX IF NOT EXISTS idx_cuentas_credito_fecha ON cuentas_credito(fecha)',
            'CREATE INDEX IF NOT EXISTS idx_historial_fecha ON historial_transacciones(fecha)'
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
        await this.ensureColumn('mesas', 'cliente_nombre', 'TEXT');
        await this.ensureColumn('mesas', 'fecha_apertura', 'TEXT');
        await this.ensureColumn('mesas', 'cantidad_personas', 'INTEGER');
        await this.ensureColumn('mesas', 'hora_estimada', 'TEXT');
        await this.normalizeLegacyTableColumns();

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
        await this.run(`UPDATE mesas SET capacidad = 1 WHERE zona = 'bar' AND tipo_asiento = 'banco' AND (capacidad IS NULL OR capacidad < 1)`);
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
    }

    async insertInitialData() {
        const userCount = await this.get('SELECT COUNT(*) as count FROM usuarios');
        if (!userCount || userCount.count === 0) {
            const hashedPassword = await bcrypt.hash('admin123', 10);
            await this.run(
                'INSERT INTO usuarios (nombre, password, tipo, activo, fecha_creacion) VALUES (?, ?, ?, ?, ?)',
                ['admin', hashedPassword, 'administrador', 1, new Date().toISOString()]
            );
            console.log('Usuario administrador inicial creado: admin / admin123');
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
