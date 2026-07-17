const { resolveRequestCapabilities, hasCapability, isAdminType } = require('../services/capabilityService');

function requireCapability(capabilityCode) {
    return async function capabilityGuard(req, res, next) {
        try {
            if (!req.session?.userId) {
                return res.status(401).json({ error: 'No autorizado', code: 'AUTH_REQUIRED' });
            }

            if (isAdminType(req.session.userType)) return next();

            const capabilities = await resolveRequestCapabilities(req);
            if (!hasCapability(capabilities, capabilityCode)) {
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
