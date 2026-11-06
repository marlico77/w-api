const test = require('node:test');
const assert = require('node:assert/strict');
const { outboundLimitReached } = require('../outboundPolicy');

test('allows the first consented send under all limits', () => {
    assert.equal(outboundLimitReached({ outreach_day: 0, outreach_contact_day: 0, unique_day: 0, last_sent: null }, 'outreach'), false);
});

test('blocks a sixth distinct recipient within 24 hours', () => {
    assert.equal(outboundLimitReached({ outreach_day: 5, outreach_contact_day: 0, unique_day: 5, last_sent: null }, 'outreach'), true);
});

test('blocks a send during the per-instance cooldown', () => {
    const now = Date.parse('2026-11-06T12:00:00Z');
    const row = { outreach_day: 1, outreach_contact_day: 1, unique_day: 1, last_sent: new Date(now - 60000) };
    assert.equal(outboundLimitReached(row, 'outreach', now), true);
    assert.equal(outboundLimitReached({ ...row, last_sent: new Date(now - 120000) }, 'outreach', now), false);
});

test('allows a recent customer reply without applying outreach limits', () => {
    const row = { sent_day: 8, contact_day: 4, outreach_day: 20, outreach_contact_day: 3, unique_day: 5, last_sent: null };
    assert.equal(outboundLimitReached(row, 'reply'), false);
});

test('limits reply bursts independently', () => {
    const now = Date.parse('2026-11-06T12:00:00Z');
    const row = { sent_day: 3, contact_day: 3, last_sent: new Date(now - 3000) };
    assert.equal(outboundLimitReached(row, 'reply', now), true);
    assert.equal(outboundLimitReached({ ...row, last_sent: new Date(now - 5000) }, 'reply', now), false);
});
