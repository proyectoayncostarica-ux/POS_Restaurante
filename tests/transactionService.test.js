const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase, applySqlStatements } = require('./helpers/testDatabase');
const { ConflictError } = require('../server/errors/domainError');

async function setupLedger() {
    const context = await createTestDatabase();
    await applySqlStatements(context.db, [
        `CREATE TABLE ledger (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            description TEXT NOT NULL,
            amount INTEGER NOT NULL
        )`,
        `CREATE TABLE balances (
            id INTEGER PRIMARY KEY,
            amount INTEGER NOT NULL CHECK(amount >= 0)
        )`
    ]);
    await context.db.run('INSERT INTO balances (id, amount) VALUES (1, 10000)');
    return context;
}

test('withTransaction confirma todas las escrituras cuando el trabajo termina', async t => {
    const context = await setupLedger();
    t.after(() => context.cleanup());

    await context.db.withTransaction(async tx => {
        await tx.run('INSERT INTO ledger (description, amount) VALUES (?, ?)', ['cargo', 1500]);
        await tx.run('UPDATE balances SET amount = amount - ? WHERE id = 1', [1500]);
    });

    const rows = await context.db.all('SELECT * FROM ledger');
    const balance = await context.db.get('SELECT amount FROM balances WHERE id = 1');
    assert.equal(rows.length, 1);
    assert.equal(balance.amount, 8500);
});

test('withTransaction revierte todas las escrituras ante una falla intermedia', async t => {
    const context = await setupLedger();
    t.after(() => context.cleanup());

    await assert.rejects(
        context.db.withTransaction(async tx => {
            await tx.run('INSERT INTO ledger (description, amount) VALUES (?, ?)', ['cargo inválido', 1500]);
            await tx.run('UPDATE balances SET amount = amount - ? WHERE id = 1', [1500]);
            throw new Error('Falla controlada');
        }),
        /Falla controlada/
    );

    const rows = await context.db.all('SELECT * FROM ledger');
    const balance = await context.db.get('SELECT amount FROM balances WHERE id = 1');
    assert.equal(rows.length, 0);
    assert.equal(balance.amount, 10000);
});

test('las transacciones anidadas usan savepoints sin cancelar la operación exterior', async t => {
    const context = await setupLedger();
    t.after(() => context.cleanup());

    await context.db.withTransaction(async tx => {
        await tx.run('INSERT INTO ledger (description, amount) VALUES (?, ?)', ['exterior A', 100]);

        await assert.rejects(
            context.db.withTransaction(async nestedTx => {
                await nestedTx.run('INSERT INTO ledger (description, amount) VALUES (?, ?)', ['interior', 200]);
                throw new Error('Rollback del savepoint');
            }),
            /Rollback del savepoint/
        );

        await tx.run('INSERT INTO ledger (description, amount) VALUES (?, ?)', ['exterior B', 300]);
    });

    const rows = await context.db.all('SELECT description FROM ledger ORDER BY id');
    assert.deepEqual(rows.map(row => row.description), ['exterior A', 'exterior B']);
});

test('afterCommit se ejecuta solo después de confirmar la transacción', async t => {
    const context = await setupLedger();
    t.after(() => context.cleanup());
    const events = [];

    await context.db.withTransaction(async tx => {
        await tx.run('INSERT INTO ledger (description, amount) VALUES (?, ?)', ['evento', 100]);
        tx.afterCommit(async () => {
            const row = await context.db.get('SELECT COUNT(*) AS total FROM ledger');
            events.push(`commit:${row.total}`);
        });
    });

    assert.deepEqual(events, ['commit:1']);
});

test('dos débitos concurrentes se serializan y nunca dejan saldo negativo', async t => {
    const context = await setupLedger();
    t.after(() => context.cleanup());

    async function debit(amount, description) {
        return context.db.withTransaction(async tx => {
            const current = await tx.get('SELECT amount FROM balances WHERE id = 1');
            if (current.amount < amount) {
                throw new ConflictError('Saldo insuficiente');
            }
            await new Promise(resolve => setTimeout(resolve, 15));
            await tx.run('UPDATE balances SET amount = amount - ? WHERE id = 1', [amount]);
            await tx.run('INSERT INTO ledger (description, amount) VALUES (?, ?)', [description, amount]);
        });
    }

    const results = await Promise.allSettled([
        debit(7000, 'primero'),
        debit(4000, 'segundo')
    ]);

    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter(result => result.status === 'rejected').length, 1);

    const balance = await context.db.get('SELECT amount FROM balances WHERE id = 1');
    const rows = await context.db.all('SELECT * FROM ledger');
    assert.equal(balance.amount, 3000);
    assert.equal(rows.length, 1);
});

test('afterCommit puede iniciar una nueva transacción sin bloquear la cola', async t => {
    const context = await setupLedger();
    t.after(() => context.cleanup());

    await context.db.withTransaction(async tx => {
        await tx.run('INSERT INTO ledger (description, amount) VALUES (?, ?)', ['principal', 100]);
        tx.afterCommit(() => context.db.withTransaction(async nextTx => {
            await nextTx.run('INSERT INTO ledger (description, amount) VALUES (?, ?)', ['posterior', 200]);
        }));
    });

    const rows = await context.db.all('SELECT description FROM ledger ORDER BY id');
    assert.deepEqual(rows.map(row => row.description), ['principal', 'posterior']);
});
