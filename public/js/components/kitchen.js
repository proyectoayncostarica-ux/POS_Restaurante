const Kitchen = {
    board: { comandas: [], total: 0, generado_en: null },
    destination: null,
    refreshTimer: null,
    clockTimer: null,
    loading: false,

    isDepartmentalKitchen() {
        const policy = Access.getPolicy();
        return policy.isDepartmental && policy.departmentCode === 'cocina';
    },

    getEffectiveDestination() {
        if (this.isDepartmentalKitchen()) return 'cocina';
        return this.destination;
    },

    async load(options = {}) {
        if (!Access.has('kitchen.operate')) {
            this.renderNoAccess();
            return;
        }

        if (this.loading && options.source === 'realtime') return;
        this.loading = true;

        try {
            const destination = this.getEffectiveDestination();
            const suffix = destination ? `?destino=${encodeURIComponent(destination)}` : '';
            const response = await Utils.request(`/kitchen/board${suffix}`);
            this.board = response.data || { comandas: [], total: 0, generado_en: null };
            this.render();
            this.ensureTimers();
            this.updateConnectionStatus(Boolean(Realtime?.isConnected));
        } catch (error) {
            console.error('Error cargando Kitchen:', error);
            if (!options.silent) {
                Utils.showNotification('No fue posible actualizar el tablero de Cocina', 'error');
            }
            this.renderError(error);
        } finally {
            this.loading = false;
        }
    },

    ensureTimers() {
        if (!this.refreshTimer) {
            this.refreshTimer = window.setInterval(() => {
                if (currentSection === 'kitchen') {
                    this.load({ source: 'poll', silent: true });
                }
            }, 30000);
        }

        if (!this.clockTimer) {
            this.clockTimer = window.setInterval(() => {
                if (currentSection === 'kitchen') this.refreshElapsedLabels();
            }, 30000);
        }
    },

    stopTimers() {
        if (this.refreshTimer) window.clearInterval(this.refreshTimer);
        if (this.clockTimer) window.clearInterval(this.clockTimer);
        this.refreshTimer = null;
        this.clockTimer = null;
    },

    setDestination(destination) {
        if (this.isDepartmentalKitchen()) return;
        const normalized = ['cocina', 'bar'].includes(destination) ? destination : null;
        if (this.destination === normalized) return;
        this.destination = normalized;
        this.load({ source: 'filter' });
    },

    updateConnectionStatus(connected) {
        const badge = document.getElementById('kitchen-connection-status');
        const offline = document.getElementById('kitchen-offline-banner');
        if (badge) {
            badge.classList.toggle('is-online', Boolean(connected));
            badge.classList.toggle('is-offline', !connected);
            badge.innerHTML = connected
                ? '<i class="fas fa-circle-check"></i><span>En línea</span>'
                : '<i class="fas fa-triangle-exclamation"></i><span>Reconectando</span>';
        }
        if (offline) offline.hidden = Boolean(connected);
    },

    renderNoAccess() {
        const section = document.getElementById('kitchen-section');
        if (!section) return;
        section.innerHTML = `
            <div class="kitchen-empty-state">
                <i class="fas fa-lock"></i>
                <h2>Acceso restringido</h2>
                <p>Esta cuenta no tiene permiso para operar el tablero de Cocina.</p>
            </div>
        `;
    },

    renderError(error) {
        const section = document.getElementById('kitchen-section');
        if (!section) return;
        section.innerHTML = `
            <div class="kitchen-empty-state">
                <i class="fas fa-wifi"></i>
                <h2>No se pudo actualizar el tablero</h2>
                <p>Revisa la conexión. Las órdenes persistidas se recuperarán automáticamente al reconectar.</p>
                <button class="btn btn-primary" type="button" onclick="Kitchen.load()">
                    <i class="fas fa-rotate"></i> Reintentar
                </button>
            </div>
        `;
    },

    render() {
        const section = document.getElementById('kitchen-section');
        if (!section) return;

        const commands = Array.isArray(this.board?.comandas) ? this.board.comandas : [];
        const pending = commands.filter(command => ['pendiente', 'enviada'].includes(command.estado_operativo));
        const preparing = commands.filter(command => command.estado_operativo === 'en_preparacion');
        const ready = commands.filter(command => command.estado_operativo === 'lista');
        const departmental = this.isDepartmentalKitchen();

        section.innerHTML = `
            <div class="kitchen-shell">
                <header class="kitchen-topbar">
                    <div class="kitchen-brand-block">
                        <span class="kitchen-brand-icon"><i class="fas fa-fire-burner"></i></span>
                        <div>
                            <span class="kitchen-eyebrow">MundiPOS · Kitchen</span>
                            <h1>Tablero de Cocina</h1>
                            <p>${this.escapeHtml(currentUser?.nombre || 'Cocina')} · solicitudes en preparación</p>
                        </div>
                    </div>
                    <div class="kitchen-topbar-actions">
                        <span id="kitchen-connection-status" class="kitchen-connection-status is-offline">
                            <i class="fas fa-triangle-exclamation"></i><span>Reconectando</span>
                        </span>
                        <button class="kitchen-refresh-btn" type="button" onclick="Kitchen.load()" aria-label="Actualizar tablero">
                            <i class="fas fa-rotate"></i><span>Actualizar</span>
                        </button>
                        ${departmental ? `
                            <button class="kitchen-logout-btn" type="button" onclick="Auth.logout()">
                                <i class="fas fa-right-from-bracket"></i><span>Cerrar sesión</span>
                            </button>
                        ` : ''}
                    </div>
                </header>

                <div id="kitchen-offline-banner" class="kitchen-offline-banner" hidden>
                    <i class="fas fa-wifi"></i>
                    <span>Sin conexión en tiempo real. El tablero intentará reconectarse automáticamente.</span>
                </div>

                <div class="kitchen-toolbar">
                    <div class="kitchen-summary" aria-label="Resumen de órdenes">
                        <span><strong>${pending.length}</strong> pendientes</span>
                        <span><strong>${preparing.length}</strong> en preparación</span>
                        <span><strong>${ready.length}</strong> listas</span>
                    </div>
                    ${departmental ? `
                        <span class="kitchen-station-chip"><i class="fas fa-location-dot"></i> Estación Cocina</span>
                    ` : `
                        <div class="kitchen-destination-filter" aria-label="Filtrar destino">
                            ${this.renderFilterButton(null, 'Todos')}
                            ${this.renderFilterButton('cocina', 'Cocina')}
                            ${this.renderFilterButton('bar', 'Bar')}
                        </div>
                    `}
                </div>

                <div class="kitchen-board">
                    ${this.renderColumn('Pendientes', 'Solicitudes nuevas y aceptadas', pending, 'pending')}
                    ${this.renderColumn('En preparación', 'Órdenes trabajando ahora', preparing, 'preparing')}
                    ${this.renderColumn('Listas', 'Esperando entrega', ready, 'ready')}
                </div>
            </div>
        `;

        this.updateConnectionStatus(Boolean(Realtime?.isConnected));
    },

    renderFilterButton(value, label) {
        const active = this.destination === value;
        const encoded = value === null ? 'null' : `'${value}'`;
        return `
            <button type="button" class="${active ? 'active' : ''}" onclick="Kitchen.setDestination(${encoded})">
                ${label}
            </button>
        `;
    },

    renderColumn(title, subtitle, commands, kind) {
        return `
            <section class="kitchen-column kitchen-column-${kind}">
                <header>
                    <div>
                        <h2>${title}</h2>
                        <p>${subtitle}</p>
                    </div>
                    <span class="kitchen-column-count">${commands.length}</span>
                </header>
                <div class="kitchen-column-scroll">
                    ${commands.length
                        ? commands.map(command => this.renderCard(command)).join('')
                        : `<div class="kitchen-column-empty"><i class="fas fa-check"></i><span>Sin órdenes</span></div>`}
                </div>
            </section>
        `;
    },

    renderCard(command) {
        const elapsed = this.elapsedMinutes(command.solicitada_en);
        const urgency = elapsed >= 30 ? 'critical' : elapsed >= 20 ? 'high' : elapsed >= 10 ? 'attention' : 'normal';
        const location = this.formatLocation(command);
        const requester = command.usuario_solicitante?.nombre || command.items?.[0]?.usuario_solicitante || 'Personal de atención';
        const changeFlags = [...new Set((command.items || []).map(item => item.tipo_cambio).filter(Boolean))];
        const changeLabel = this.changeLabel(changeFlags);
        const nextAction = this.nextAction(command.estado_operativo);

        return `
            <article class="kitchen-order-card urgency-${urgency}" data-kitchen-command-id="${Number(command.id)}">
                <div class="kitchen-order-head">
                    <div>
                        <span class="kitchen-order-number">${this.escapeHtml(command.numero_comanda || `Comanda ${command.id}`)}</span>
                        <strong>${this.escapeHtml(location)}</strong>
                        <small>${this.escapeHtml(command.zona?.nombre || 'Zona')}</small>
                    </div>
                    <div class="kitchen-order-time">
                        <time>${this.formatTime(command.solicitada_en)}</time>
                        <span class="kitchen-elapsed" data-requested-at="${this.escapeHtml(command.solicitada_en || '')}">
                            ${this.elapsedText(elapsed)}
                        </span>
                    </div>
                </div>

                <div class="kitchen-requester">
                    <i class="fas fa-user"></i>
                    <span>Solicitó: <strong>${this.escapeHtml(requester)}</strong></span>
                    <span class="kitchen-destination-badge">${this.escapeHtml(this.destinationLabel(command.destino))}</span>
                </div>

                ${changeLabel ? `<div class="kitchen-change-alert"><i class="fas fa-circle-exclamation"></i>${this.escapeHtml(changeLabel)}</div>` : ''}

                <div class="kitchen-items">
                    ${(command.items || []).map(item => this.renderItem(item)).join('')}
                </div>

                <div class="kitchen-order-footer">
                    <span class="kitchen-state-label">${this.escapeHtml(this.stateLabel(command.estado_operativo))}</span>
                    <div class="kitchen-order-actions">
                        ${nextAction ? `
                            <button class="kitchen-action-primary" type="button"
                                    onclick="Kitchen.transition(${Number(command.id)}, '${nextAction.state}', ${Number(command.version)})">
                                <i class="fas ${nextAction.icon}"></i>${nextAction.label}
                            </button>
                        ` : ''}
                        ${!['entregada', 'anulada'].includes(command.estado_operativo) ? `
                            <button class="kitchen-action-secondary" type="button"
                                    onclick="Kitchen.resend(${Number(command.id)})"
                                    title="Reenviar instrucción">
                                <i class="fas fa-paper-plane"></i>
                            </button>
                            <button class="kitchen-action-danger" type="button"
                                    onclick="Kitchen.cancel(${Number(command.id)}, ${Number(command.version)})"
                                    title="Anular">
                                <i class="fas fa-ban"></i>
                            </button>
                        ` : ''}
                    </div>
                </div>
            </article>
        `;
    },

    renderItem(item) {
        const quantity = Math.abs(Number(item.cantidad || item.cantidad_resultante || 0));
        const presentation = [item.presentacion, item.presentacion_cantidad].filter(Boolean).join(' · ');
        const notes = [];
        if (Array.isArray(item.adicionales) && item.adicionales.length) {
            notes.push(`<div class="kitchen-special"><i class="fas fa-plus"></i><strong>Adicionales:</strong> ${item.adicionales.map(value => this.escapeHtml(value)).join(', ')}</div>`);
        }
        if (item.observacion) {
            notes.push(`<div class="kitchen-special"><i class="fas fa-message"></i><strong>Indicaciones:</strong> ${this.escapeHtml(item.observacion)}</div>`);
        }
        if (item.motivo) {
            notes.push(`<div class="kitchen-item-reason"><i class="fas fa-circle-info"></i>${this.escapeHtml(item.motivo)}</div>`);
        }

        return `
            <div class="kitchen-item ${item.tipo_cambio === 'anulacion' ? 'is-cancelled' : ''}">
                <div class="kitchen-item-main">
                    <span class="kitchen-item-quantity">${quantity || '—'}×</span>
                    <div>
                        <strong>${this.escapeHtml(item.producto || 'Producto')}</strong>
                        ${presentation ? `<small>${this.escapeHtml(presentation)}</small>` : ''}
                    </div>
                </div>
                ${notes.join('')}
            </div>
        `;
    },

    nextAction(state) {
        const actions = {
            pendiente: { state: 'enviada', label: 'Aceptar', icon: 'fa-check' },
            enviada: { state: 'en_preparacion', label: 'Preparar', icon: 'fa-fire-burner' },
            en_preparacion: { state: 'lista', label: 'Marcar lista', icon: 'fa-bell-concierge' },
            lista: { state: 'entregada', label: 'Entregar', icon: 'fa-circle-check' }
        };
        return actions[state] || null;
    },

    async transition(id, state, version) {
        try {
            await Utils.request(`/kitchen/comandas/${Number(id)}/state`, {
                method: 'PUT',
                body: JSON.stringify({ estado_operativo: state, expectedVersion: Number(version) })
            });
            await this.load({ source: 'state', silent: true });
        } catch (error) {
            if (String(error.message || '').toLowerCase().includes('cambió')) {
                Utils.showNotification('La orden cambió en otra estación. Se actualizará el tablero.', 'warning');
                await this.load({ source: 'conflict', silent: true });
                return;
            }
            Utils.showNotification(error.message || 'No fue posible actualizar la orden', 'error');
        }
    },

    async cancel(id, version) {
        const confirmed = await Utils.confirm(
            '¿Anular esta orden de preparación? Esta acción quedará registrada.',
            'Anular orden'
        );
        if (!confirmed) return;
        const reason = window.prompt('Motivo de la anulación:');
        if (!reason || !reason.trim()) {
            Utils.showNotification('Debes indicar el motivo de la anulación', 'warning');
            return;
        }

        try {
            await Utils.request(`/kitchen/comandas/${Number(id)}/state`, {
                method: 'PUT',
                body: JSON.stringify({
                    estado_operativo: 'anulada',
                    expectedVersion: Number(version),
                    motivo: reason.trim()
                })
            });
            await this.load({ source: 'cancel', silent: true });
        } catch (error) {
            Utils.showNotification(error.message || 'No fue posible anular la orden', 'error');
            await this.load({ source: 'cancel-error', silent: true });
        }
    },

    async resend(id) {
        const confirmed = await Utils.confirm(
            '¿Reenviar esta instrucción a preparación? Se creará una nueva orden vinculada a la original.',
            'Reenviar orden'
        );
        if (!confirmed) return;
        const reason = window.prompt('Motivo del reenvío:');
        if (!reason || !reason.trim()) {
            Utils.showNotification('Debes indicar el motivo del reenvío', 'warning');
            return;
        }

        try {
            await Utils.request(`/kitchen/comandas/${Number(id)}/resend`, {
                method: 'POST',
                body: JSON.stringify({ motivo: reason.trim() })
            });
            await this.load({ source: 'resend', silent: true });
        } catch (error) {
            Utils.showNotification(error.message || 'No fue posible reenviar la orden', 'error');
        }
    },

    refreshElapsedLabels() {
        document.querySelectorAll('.kitchen-elapsed[data-requested-at]').forEach(element => {
            const elapsed = this.elapsedMinutes(element.dataset.requestedAt);
            element.textContent = this.elapsedText(elapsed);
        });
    },

    elapsedMinutes(value) {
        const date = new Date(value || 0);
        if (Number.isNaN(date.getTime())) return 0;
        return Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
    },

    elapsedText(minutes) {
        if (minutes < 1) return 'Ahora';
        if (minutes === 1) return '1 min';
        return `${minutes} min`;
    },

    formatTime(value) {
        const date = new Date(value || 0);
        if (Number.isNaN(date.getTime())) return '--:--';
        return new Intl.DateTimeFormat('es-CR', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        }).format(date);
    },

    formatLocation(command) {
        const type = String(command.mesa?.tipo || '').toLowerCase();
        const prefix = type.includes('banco') ? 'Banco' : 'Mesa';
        const number = command.mesa?.numero;
        return number !== null && number !== undefined ? `${prefix} ${number}` : prefix;
    },

    destinationLabel(destination) {
        return String(destination || '').toLowerCase() === 'bar' ? 'Bar' : 'Cocina';
    },

    stateLabel(state) {
        const labels = {
            pendiente: 'Pendiente',
            enviada: 'Aceptada',
            en_preparacion: 'En preparación',
            lista: 'Lista',
            entregada: 'Entregada',
            anulada: 'Anulada'
        };
        return labels[state] || 'Pendiente';
    },

    changeLabel(types = []) {
        if (types.includes('anulacion')) return 'La orden contiene una anulación o reducción';
        if (types.includes('ajuste')) return 'La orden contiene una modificación';
        if (types.includes('reenvio')) return 'Orden reenviada';
        return '';
    },

    escapeHtml(value = '') {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
};

window.Kitchen = Kitchen;
