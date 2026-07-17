(function bootstrapOperationalAccess(root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.OperationalAccess = api;
})(typeof window !== 'undefined' ? window : globalThis, function createOperationalAccess() {
    const SECTION_REQUIREMENTS = Object.freeze({
        dashboard: 'orders.operate',
        tables: 'orders.operate',
        menu: 'orders.operate',
        orders: 'orders.operate',
        accounts: 'orders.operate',
        cash: 'cash.access',
        users: '__admin__',
        settings: '__admin__'
    });

    const REALTIME_SCOPE_RULES = Object.freeze({
        sesion: { targetedOnly: true },
        usuarios: { adminOnly: true, allowTarget: true },
        sistema: { adminOnly: true, allowTarget: true },
        estructura: { anyCapabilities: ['orders.operate'], zoneAware: false },
        menu: { anyCapabilities: ['orders.operate'], zoneAware: false },
        zonas: { anyCapabilities: ['orders.operate'], zoneAware: true },
        responsabilidad: { anyCapabilities: ['orders.operate'], zoneAware: true },
        pedidos: { anyCapabilities: ['orders.operate'], zoneAware: true },
        comandas: { anyCapabilities: ['kitchen.operate', 'orders.operate'], zoneAware: true },
        caja: { anyCapabilities: ['cash.access'], zoneAware: false },
        pagos: { anyCapabilities: ['cash.access', 'orders.operate'], zoneAware: true, cashGlobal: true },
        cuentas: { anyCapabilities: ['cash.access', 'orders.operate'], zoneAware: true, cashGlobal: true },
        creditos: { anyCapabilities: ['cash.access', 'orders.operate'], zoneAware: false },
        operacion: { anyCapabilities: ['orders.operate', 'cash.access'], zoneAware: true }
    });

    function normalizeCodes(values) {
        const raw = Array.isArray(values) ? values : [values];
        return [...new Set(raw.map(value => String(value || '').trim()).filter(Boolean))];
    }

    function normalizeIds(values) {
        if (values === null || values === undefined || values === '') return [];
        const raw = Array.isArray(values) ? values : [values];
        return [...new Set(raw.flatMap(value => Array.isArray(value) ? value : [value])
            .map(value => Number(value))
            .filter(value => Number.isInteger(value) && value > 0))];
    }

    function isAdmin(user) {
        const type = String(user?.tipo || user?.userType || '').trim().toLowerCase();
        return type === 'administrador' || type === 'admin';
    }

    function buildPolicy(user) {
        const supplied = user?.acceso_operativo || {};
        const session = user?.sesion_operativa || {};
        const activeRoles = Array.isArray(session.roles_trabajo_activos) ? session.roles_trabajo_activos : [];
        const admin = isAdmin(user);
        const capabilities = normalizeCodes(
            supplied.capabilities || supplied.capacidades || user?.capacidades || session.capacidades || []
        );
        const zoneIds = supplied.zoneIds === null || supplied.zone_ids === null
            ? null
            : normalizeIds(supplied.zoneIds || supplied.zone_ids || activeRoles.flatMap(role =>
                (Array.isArray(role.zonas) ? role.zonas : []).map(zone => zone.id)
            ));
        const allowedSections = Array.isArray(supplied.allowedSections)
            ? supplied.allowedSections
            : Object.keys(SECTION_REQUIREMENTS).filter(section => canOpen({ isAdmin: admin, capabilities }, section));

        return {
            userId: Number(user?.id || supplied.userId || 0) || null,
            isAdmin: admin,
            capabilities,
            zoneIds: admin ? null : zoneIds,
            allowedSections,
            initialSection: supplied.initialSection || supplied.initial_section || user?.destino_inicial || session.destino_inicial || 'dashboard'
        };
    }

    function has(policyOrUser, capabilityCode) {
        const policy = policyOrUser?.capabilities ? policyOrUser : buildPolicy(policyOrUser);
        if (policy.isAdmin) return true;
        return normalizeCodes(policy.capabilities).includes(String(capabilityCode || '').trim());
    }

    function hasAny(policyOrUser, codes) {
        const policy = policyOrUser?.capabilities ? policyOrUser : buildPolicy(policyOrUser);
        if (policy.isAdmin) return true;
        const available = new Set(normalizeCodes(policy.capabilities));
        return normalizeCodes(codes).some(code => available.has(code));
    }

    function canOpen(policyOrUser, sectionName) {
        const policy = policyOrUser?.capabilities ? policyOrUser : buildPolicy(policyOrUser);
        const required = SECTION_REQUIREMENTS[String(sectionName || '').trim()];
        if (!required) return false;
        if (required === '__admin__') return Boolean(policy.isAdmin);
        return has(policy, required);
    }

    function getInitialSection(user) {
        const policy = buildPolicy(user);
        const requested = policy.initialSection;
        if (requested && canOpen(policy, requested)) return requested;
        if (canOpen(policy, 'dashboard')) return 'dashboard';
        if (canOpen(policy, 'cash')) return 'cash';
        return policy.allowedSections[0] || 'dashboard';
    }

    function isTargeted(policy, payload) {
        const userId = Number(policy.userId || 0);
        if (!userId) return false;
        const ids = normalizeIds([
            ...(Array.isArray(payload?.targetUserIds) ? payload.targetUserIds : []),
            ...(Array.isArray(payload?.affectedUserIds) ? payload.affectedUserIds : []),
            payload?.targetUserId,
            payload?.affectedUserId
        ]);
        return ids.includes(userId);
    }

    function canReceiveRealtime(user, payload) {
        const policy = buildPolicy(user);
        if (!policy.userId) return false;
        if (policy.isAdmin) return true;

        const targeted = isTargeted(policy, payload || {});
        const scope = String(payload?.scope || 'operacion').trim().toLowerCase();
        const rule = REALTIME_SCOPE_RULES[scope] || REALTIME_SCOPE_RULES.operacion;

        if (rule.targetedOnly) return targeted;
        if (rule.adminOnly) return Boolean(rule.allowTarget && targeted);

        const explicitAny = normalizeCodes(payload?.requiredAnyCapabilities || []);
        if (explicitAny.length && !hasAny(policy, explicitAny)) return false;
        const explicitAll = normalizeCodes(payload?.requiredAllCapabilities || []);
        if (explicitAll.length && !explicitAll.every(code => has(policy, code))) return false;
        if (rule.anyCapabilities && !hasAny(policy, rule.anyCapabilities)) return false;

        if (rule.cashGlobal && has(policy, 'cash.access')) return true;
        if (payload?.global === true && !rule.zoneAware) return true;

        if (rule.zoneAware) {
            const eventZones = normalizeIds(payload?.zoneIds || payload?.zonaIds || payload?.zonaId || []);
            if (!eventZones.length || !Array.isArray(policy.zoneIds)) return false;
            return eventZones.some(zoneId => policy.zoneIds.includes(zoneId));
        }

        return true;
    }

    return Object.freeze({
        SECTION_REQUIREMENTS,
        REALTIME_SCOPE_RULES,
        buildPolicy,
        has,
        hasAny,
        canOpen,
        getInitialSection,
        canReceiveRealtime
    });
});
