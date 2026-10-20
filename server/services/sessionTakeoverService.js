const crypto = require('crypto');
const realtime = require('../utils/realtime');

class SessionTakeoverService {
    constructor() {
        this.pendingTakeovers = new Map(); // userId -> takeover object
    }

    initiateTakeover({ userId, targetClientId, requesterClientId, timeoutMs = 5500 }) {
        this.cancelTakeover(userId, { targetClientId });

        const takeoverId = typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                if (this.pendingTakeovers.get(userId)?.takeoverId === takeoverId) {
                    this.pendingTakeovers.delete(userId);
                    resolve({ outcome: 'accepted', reason: 'countdown_expired' });
                }
            }, timeoutMs);

            const takeover = {
                takeoverId,
                userId,
                targetClientId,
                requesterClientId,
                timer,
                resolve,
                createdAt: Date.now()
            };

            this.pendingTakeovers.set(userId, takeover);

            // Emitir evento SSE al dispositivo objetivo con cuenta regresiva
            realtime.sendToClient(targetClientId, 'session-takeover-countdown', {
                takeoverId,
                countdownSeconds: 5,
                requesterClientId,
                message: 'Un nuevo dispositivo desea iniciar sesión con tu usuario.'
            });
        });
    }

    rejectTakeover(userId, options = {}) {
        const numericUserId = Number(userId);
        const takeover = this.pendingTakeovers.get(numericUserId);
        if (!takeover) return false;
        if (options.takeoverId && takeover.takeoverId !== options.takeoverId) return false;

        clearTimeout(takeover.timer);
        this.pendingTakeovers.delete(numericUserId);
        takeover.resolve({ outcome: 'rejected', reason: 'user_rejected' });
        return true;
    }

    acceptTakeover(userId, options = {}) {
        const numericUserId = Number(userId);
        const takeover = this.pendingTakeovers.get(numericUserId);
        if (!takeover) return false;
        if (options.takeoverId && takeover.takeoverId !== options.takeoverId) return false;

        clearTimeout(takeover.timer);
        this.pendingTakeovers.delete(numericUserId);
        takeover.resolve({ outcome: 'accepted', reason: 'user_accepted' });
        return true;
    }

    cancelTakeover(userId, options = {}) {
        const numericUserId = Number(userId);
        const targetClientId = options.targetClientId;

        if (numericUserId) {
            const takeover = this.pendingTakeovers.get(numericUserId);
            if (takeover) {
                clearTimeout(takeover.timer);
                this.pendingTakeovers.delete(numericUserId);
                takeover.resolve({ outcome: 'cancelled', reason: 'requester_cancelled' });
            }
        }

        if (targetClientId) {
            realtime.sendToClient(targetClientId, 'session-closure-cancelled', {
                targetClientId,
                message: 'La solicitud de inicio de sesión en otro dispositivo fue cancelada.'
            });
        }
        return true;
    }

    clearTakeovers() {
        for (const [userId, takeover] of this.pendingTakeovers.entries()) {
            clearTimeout(takeover.timer);
            takeover.resolve({ outcome: 'cancelled', reason: 'cleared' });
        }
        this.pendingTakeovers.clear();
    }
}

const sessionTakeoverService = new SessionTakeoverService();
module.exports = sessionTakeoverService;

