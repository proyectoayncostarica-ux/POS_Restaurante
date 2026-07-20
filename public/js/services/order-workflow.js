const OrderWorkflow = {
    async openInCash(orderId) {
        const id = Number(orderId);
        if (!id) {
            Utils.showNotification('Cuenta inválida.', 'warning');
            return;
        }
        if (typeof Access !== 'undefined' && !Access.has('cash.access')) {
            Utils.showNotification('Tu sesión no tiene acceso a Caja.', 'warning');
            return;
        }
        if (typeof Navigation === 'undefined' || typeof Cash === 'undefined') {
            Utils.showNotification('Caja no está disponible en esta sesión.', 'error');
            return;
        }
        await Navigation.showSection('cash');
        await Cash.focusAccount(id);
    }
};
