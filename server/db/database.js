const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, '../../data/restaurant.db');

class Database {
    constructor() {
        this.db = null;
    }

    connect() {
        return new Promise((resolve, reject) => {
            this.db = new sqlite3.Database(DB_PATH, (err) => {
                if (err) {
                    console.error('Error al conectar con la base de datos:', err);
                    reject(err);
                } else {
                    console.log('Conectado a la base de datos SQLite');
                    resolve();
                }
            });
        });
    }

    async initializeDatabase() {
        await this.connect();
        await this.createTables();
        await this.insertInitialData();
    }

    createTables() {
        return new Promise((resolve, reject) => {
            const tables = [


                // Tabla mesas
                `CREATE TABLE IF NOT EXISTS mesas (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    numero INTEGER NOT NULL,
                    capacidad INTEGER NOT NULL,
                    estado TEXT NOT NULL CHECK(estado IN (
                        'libre',
                        'ocupada',
                        'reservada'
                    )),
                    cliente_nombre TEXT,
                    fecha_apertura TEXT,
                    cantidad_personas INTEGER,
                    hora_estimada TEXT,
                    tipo TEXT,
                    UNIQUE (numero, tipo)
                )`,

                // Tabla categorias
                `CREATE TABLE IF NOT EXISTS categorias (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    nombre TEXT NOT NULL UNIQUE,
                    parent_id INTEGER,
                    permite_cocina INTEGER NOT NULL DEFAULT 0,
                    FOREIGN KEY (parent_id) REFERENCES categorias (id)
                )`,

                // Tabla productos
                `CREATE TABLE IF NOT EXISTS productos (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    nombre TEXT NOT NULL,
                    descripcion TEXT,
                    precio REAL NOT NULL,
                    categoria_id INTEGER NOT NULL,
                    subcategoria_id INTEGER,
                    es_cocina INTEGER NOT NULL DEFAULT 0,
                    FOREIGN KEY (categoria_id) REFERENCES categorias (id),
                    FOREIGN KEY (subcategoria_id) REFERENCES categorias (id)
                )`,

                // Tabla presentaciones
                `CREATE TABLE IF NOT EXISTS presentaciones (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    nombre TEXT NOT NULL UNIQUE,
                    cantidad TEXT
                )`,

                // Tabla presentaciones_producto
                `CREATE TABLE IF NOT EXISTS presentaciones_producto (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    producto_id INTEGER NOT NULL,
                    presentacion_id INTEGER NOT NULL,
                    precio REAL NOT NULL,
                    FOREIGN KEY (producto_id) REFERENCES productos (id),
                    FOREIGN KEY (presentacion_id) REFERENCES presentaciones (id)
                )`,





         // Tabla pagos
                `CREATE TABLE IF NOT EXISTS pagos (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    pedido_id INTEGER NOT NULL,
                    metodo_pago TEXT NOT NULL CHECK(metodo_pago IN ('efectivo', 'tarjeta', 'credito')),
                    monto REAL NOT NULL,
                    fecha TEXT NOT NULL,
                    FOREIGN KEY (pedido_id) REFERENCES pedidos (id)
                )`,

                // Tabla cuentas_credito
                `CREATE TABLE IF NOT EXISTS cuentas_credito (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    cliente_nombre TEXT NOT NULL,
                    monto_total REAL NOT NULL,
                    fecha TEXT NOT NULL
                )`,

                // Tabla configuracion
                `CREATE TABLE IF NOT EXISTS configuracion (
                    clave TEXT PRIMARY KEY,
                    valor TEXT
                )`,

                // Tabla historial_transacciones
                `CREATE TABLE IF NOT EXISTS historial_transacciones (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    tipo_accion TEXT NOT NULL,
                    usuario_id INTEGER,
                    descripcion TEXT,
                    fecha TEXT NOT NULL,
                    FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
                )`,

                // Tabla respaldos
                `CREATE TABLE IF NOT EXISTS respaldos (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    nombre_archivo TEXT NOT NULL,
                    ruta TEXT NOT NULL,
                    fecha_creacion TEXT NOT NULL
                )`,

                // Tabla comandas
                `CREATE TABLE IF NOT EXISTS comandas (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    mesa_id INTEGER NOT NULL,
                    productos_cocina TEXT NOT NULL,
                    fecha_impresion TEXT NOT NULL,
                    estado TEXT NOT NULL CHECK(estado IN ('pendiente', 'impresa', 'entregada')),
                    FOREIGN KEY (mesa_id) REFERENCES mesas (id)
                )`,

                // Tabla pagos_creditos
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
                    FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
                )`
            ];

            let completed = 0;
            tables.forEach((sql, index) => {
                this.db.run(sql, (err) => {
                    if (err) {
                        console.error(`Error creando tabla ${index}:`, err);
                        reject(err);
                        return;
                    }
                    completed++;
                    if (completed === tables.length) {
                        console.log('Todas las tablas creadas exitosamente');
                        resolve();
                    }
                });
            });
        });
    }

    async insertInitialData() {
        return new Promise(async (resolve, reject) => {
            try {
                // Verificar si ya existen datos
                const userCount = await this.get('SELECT COUNT(*) as count FROM usuarios');
                if (userCount.count > 0) {
                    console.log('Datos iniciales ya existen');
                    resolve();
                    return;
                }

                // Crear usuario administrador por defecto
                const hashedPassword = await bcrypt.hash('admin123', 10);
                await this.run(
                    'INSERT INTO usuarios (nombre, password, tipo, fecha_creacion) VALUES (?, ?, ?, ?)',
                    ['admin', hashedPassword, 'administrador', new Date().toISOString()]
                );

                // Insertar categorías principales
                await this.run('INSERT INTO categorias (nombre, parent_id, permite_cocina) VALUES (?, ?, ?)', ['Alimentos', null, 1]);
                await this.run('INSERT INTO categorias (nombre, parent_id, permite_cocina) VALUES (?, ?, ?)', ['Bebidas', null, 0]);
                await this.run('INSERT INTO categorias (nombre, parent_id, permite_cocina) VALUES (?, ?, ?)', ['Entradas', null, 0]);

                // Obtener IDs de categorías principales
                const alimentosId = await this.get('SELECT id FROM categorias WHERE nombre = ?', ['Alimentos']);
                const bebidasId = await this.get('SELECT id FROM categorias WHERE nombre = ?', ['Bebidas']);

                // Insertar subcategorías
                await this.run('INSERT INTO categorias (nombre, parent_id, permite_cocina) VALUES (?, ?, ?)', ['Preparados', alimentosId.id, 1]);
                await this.run('INSERT INTO categorias (nombre, parent_id, permite_cocina) VALUES (?, ?, ?)', ['Fríos', alimentosId.id, 0]);
                await this.run('INSERT INTO categorias (nombre, parent_id, permite_cocina) VALUES (?, ?, ?)', ['Cervezas', bebidasId.id, 0]);
                await this.run('INSERT INTO categorias (nombre, parent_id, permite_cocina) VALUES (?, ?, ?)', ['Gaseosas', bebidasId.id, 0]);

                // Insertar algunas mesas de ejemplo
                for (let i = 1; i <= 10; i++) {
                    await this.run('INSERT INTO mesas (numero, capacidad, estado) VALUES (?, ?, ?)', [i, 4, 'libre']);
                }

                // Insertar configuración inicial
                await this.run('INSERT INTO configuracion (clave, valor) VALUES (?, ?)', ['nombre_restaurante', 'Mi Restaurante']);
                await this.run('INSERT INTO configuracion (clave, valor) VALUES (?, ?)', ['direccion', 'Calle Principal 123']);
                await this.run('INSERT INTO configuracion (clave, valor) VALUES (?, ?)', ['telefono', '+1234567890']);
                await this.run('INSERT INTO configuracion (clave, valor) VALUES (?, ?)', ['moneda', '$']);

                console.log('Datos iniciales insertados exitosamente');
                resolve();
            } catch (error) {
                console.error('Error insertando datos iniciales:', error);
                reject(error);
            }
        });
    }

    run(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ id: this.lastID, changes: this.changes });
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
            this.db.close((err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }
}

const database = new Database();
module.exports = database;

