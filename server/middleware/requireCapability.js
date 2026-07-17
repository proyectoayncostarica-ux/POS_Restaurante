const {
    resolveAccessContext,
    hasCapability
} = require('../services/operationalAccessService');

function requireCapability(capabilityCode) {
    return async function capabilityGuard(req, res, next) {
        try {
            if (!req.session?.userId) {
                return res.status(401).json({ error: 'No autorizado', code: 'AUTH_REQUIRED' });
            }

            const access = await resolveAccessContext(req);
            if (!hasCapability(access, capabilityCode)) {
                return res.status(403).json({
                    error: 'Tu usuario no tiene la capacidad requerida para esta operación.',
                    code: 'CAPABILITY_REQUIRED',
                    capability: capabilityCode
                });
            }

            return next();
        } catch (error) {
            return next(error);
        }
    };
}

module.exports = requireCapability;
