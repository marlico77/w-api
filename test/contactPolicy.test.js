const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyOutboundContact } = require('../contactPolicy');

const now = Date.parse('2026-11-06T12:00:00Z');

test('allows a reply to a recent inbound message without campaign consent', () => {
    const contact = { opt_in: 0, opt_out: 0, last_inbound_at: new Date(now - 60000) };
    assert.equal(classifyOutboundContact(contact, 'reply', now), 'reply');
    assert.equal(classifyOutboundContact(contact, 'outreach', now), null);
});

test('requires consent after the reply window', () => {
    const contact = { opt_in: 0, opt_out: 0, last_inbound_at: new Date(now - 24 * 60 * 60 * 1000) };
    assert.equal(classifyOutboundContact(contact, 'reply', now), null);
});

test('never sends to a contact who opted out', () => {
    const contact = { opt_in: 1, opt_out: 1, consent_at: new Date(now), last_inbound_at: new Date(now - 60000) };
    assert.equal(classifyOutboundContact(contact, 'reply', now), null);
    assert.equal(classifyOutboundContact(contact, 'outreach', now), null);
});

test('allows outreach only with recorded consent', () => {
    const contact = { opt_in: 1, opt_out: 0, consent_at: new Date(now), last_inbound_at: null };
    assert.equal(classifyOutboundContact(contact, 'outreach', now), 'outreach');
});
