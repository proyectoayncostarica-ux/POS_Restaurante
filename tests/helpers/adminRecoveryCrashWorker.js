const { Database } = require('../../server/db/database');
const { AdminRecoveryService } = require('../../server/services/adminRecoveryService');

// Solo infraestructura de prueba: ninguna ruta productiva conoce este worker.
process.once('message', async config => {
    const db = new Database({ dbPath: config.main, mustExist: true });
    const sessionDb = new Database({ dbPath: config.sessions, mustExist: true });
    try {
        await db.connect();
        await sessionDb.connect();
        const wrappedSessions = {
            dbPath: sessionDb.dbPath, transactionStorage: sessionDb.transactionStorage,
            get: sessionDb.get.bind(sessionDb), all: sessionDb.all.bind(sessionDb), run: sessionDb.run.bind(sessionDb),
            withTransaction: async (work, options) => {
                const result = await sessionDb.withTransaction(work, options);
                // El COMMIT técnico real ya resolvió; MAIN aún tiene su transacción abierta.
                if (config.crash && options.mode === 'IMMEDIATE') process.exit(86);
                return result;
            }
        };
        const service = new AdminRecoveryService({ db, sessionDb: wrappedSessions });
        const result = await service.recover(config.operationId
            ? { operationId: config.operationId, newPassword: config.password }
            : { action: 'reset_password', targetUserId: config.targetId, newPassword: config.password, reason: 'Prueba real de interrupcion' });
        process.send({ operationId: result.operation_id, state: result.state });
    } catch {
        process.exitCode = 1;
    } finally {
        await Promise.all([db.close(), sessionDb.close()]);
        process.disconnect();
    }
});
