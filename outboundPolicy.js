function outboundLimitReached(row, purpose, now = Date.now()) {
    if (purpose === 'reply') {
        if (row.sent_day >= 100 || row.contact_day >= 20) return true;
        return Boolean(row.last_sent && now - new Date(row.last_sent).getTime() < 5000);
    }
    if (row.outreach_day >= 20 || row.outreach_contact_day >= 3) return true;
    if (row.outreach_contact_day === 0 && row.unique_day >= 5) return true;
    return Boolean(row.last_sent && now - new Date(row.last_sent).getTime() < 120000);
}

module.exports = { outboundLimitReached };
