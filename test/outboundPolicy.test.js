const test = require('node:test');
const assert = require('node:assert/strict');
const { outboundLimitReached } = require('../outboundPolicy');

test('allows the first consented send under all limits', () => {
    assert.equal(outboundLimitReached({ sent_day: 0, contact_day: 0, unique_day: 0, last_sent: null }), false);
});

test('blocks a sixth distinct recipient within 24 hours', () => {
    assert.equal(outboundLimitReached({ sent_day: 5, contact_day: 0, unique_day: 5, last_sent: null }), true);
});

test('blocks a send during the per-instance cooldown', () => {
    const now = Date.parse('2026-11-06T12:00:00Z');
    assert.equal(outboundLimitReached({ sent_day: 1, contact_day: 1, unique_day: 1, last_sent: new Date(now - 60000) }, now), true);
    assert.equal(outboundLimitReached({ sent_day: 1, contact_day: 1, unique_day: 1, last_sent: new Date(now - 120000) }, now), false);
});
