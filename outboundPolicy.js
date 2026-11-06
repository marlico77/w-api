const MIN_INTERVAL_MS = 120000;

function outboundLimitReached(row, now = Date.now()) {
    if (row.sent_day >= 20) return true;
    if (row.contact_day >= 3) return true;
    if (row.contact_day === 0 && row.unique_day >= 5) return true;
    return Boolean(row.last_sent && now - new Date(row.last_sent).getTime() < MIN_INTERVAL_MS);
}

module.exports = { outboundLimitReached };
