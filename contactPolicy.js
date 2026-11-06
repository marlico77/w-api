const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

function classifyOutboundContact(contact, requestedMode, now = Date.now()) {
    if (!contact || contact.opt_out === 1) return null;
    const recentInbound = requestedMode === 'reply' && contact.last_inbound_at &&
        now - new Date(contact.last_inbound_at).getTime() >= 0 &&
        now - new Date(contact.last_inbound_at).getTime() < REPLY_WINDOW_MS;
    if (recentInbound) return 'reply';
    if (contact.opt_in === 1 && contact.consent_at) return 'outreach';
    return null;
}

module.exports = { classifyOutboundContact };
