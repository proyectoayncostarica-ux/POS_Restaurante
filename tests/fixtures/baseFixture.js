const BASE_SCHEMA = [
    `CREATE TABLE usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL UNIQUE,
        tipo TEXT NOT NULL,
        activo INTEGER NOT NULL DEFAULT 1
    )`,
    `CREATE TABLE roles_trabajo (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL UNIQUE,
        slug TEXT NOT NULL UNIQUE,
        activo INTEGER NOT NULL DEFAULT 1
    )`,
    `CREATE TABLE zonas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL UNIQUE,
        slug TEXT NOT NULL UNIQUE,
        activa INTEGER NOT NULL DEFAULT 1
    )`,
    `CREATE TABLE mesas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        numero INTEGER NOT NULL,
        zona_id INTEGER NOT NULL,
        estado TEXT NOT NULL DEFAULT 'libre',
        cliente_nombre TEXT,
        FOREIGN KEY (zona_id) REFERENCES zonas(id)
    )`,
    `CREATE TABLE productos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL,
        precio REAL NOT NULL,
        activo INTEGER NOT NULL DEFAULT 1
    )`,
    `CREATE TABLE pedidos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mesa_id INTEGER NOT NULL,
        usuario_id INTEGER NOT NULL,
        estado TEXT NOT NULL DEFAULT 'pendiente',
        total REAL NOT NULL DEFAULT 0,
        FOREIGN KEY (mesa_id) REFERENCES mesas(id),
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
    )`
];

async function seedBaseFixture(db) {
    await db.withTransaction(async tx => {
        const user = await tx.run(
            `INSERT INTO usuarios (nombre, tipo) VALUES (?, ?)`,
            ['Andrey', 'basico']
        );
        await tx.run(
            `INSERT INTO roles_trabajo (nombre, slug) VALUES (?, ?)`,
            ['Salonero', 'salonero']
        );
        const zone = await tx.run(
            `INSERT INTO zonas (nombre, slug) VALUES (?, ?)`,
            ['Salón', 'salon']
        );
        const table = await tx.run(
            `INSERT INTO mesas (numero, zona_id, estado, cliente_nombre) VALUES (?, ?, ?, ?)`,
            [1, zone.id, 'ocupada', 'Juan']
        );
        await tx.run(
            `INSERT INTO productos (nombre, precio) VALUES (?, ?)`,
            ['Imperial 350 ml', 1500]
        );
        await tx.run(
            `INSERT INTO pedidos (mesa_id, usuario_id, estado, total) VALUES (?, ?, ?, ?)`,
            [table.id, user.id, 'pendiente', 4500]
        );
    });
}

module.exports = {
    BASE_SCHEMA,
    seedBaseFixture
};
