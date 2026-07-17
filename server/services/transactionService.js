const database = require('../db/database');

class TransactionService {
    constructor(db = database) {
        this.db = db;
    }

    run(work, options = {}) {
        return this.db.withTransaction(work, options);
    }

    immediate(work, options = {}) {
        return this.run(work, { ...options, mode: 'IMMEDIATE' });
    }

    deferred(work, options = {}) {
        return this.run(work, { ...options, mode: 'DEFERRED' });
    }

    exclusive(work, options = {}) {
        return this.run(work, { ...options, mode: 'EXCLUSIVE' });
    }
}

const transactionService = new TransactionService();

module.exports = transactionService;
module.exports.TransactionService = TransactionService;
