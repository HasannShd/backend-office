const test = require('node:test');
const assert = require('node:assert/strict');

const { buildIdentifierQuery } = require('../utils/identifier');

const matchesQuery = (user, query) =>
  query.$or.some((condition) => {
    const [[field, expected]] = Object.entries(condition);
    const actual = user[field];
    if (expected instanceof RegExp) return expected.test(actual);
    return actual === expected;
  });

test('buildIdentifierQuery matches usernames case-insensitively', () => {
  const query = buildIdentifierQuery('admin');

  assert.equal(matchesQuery({ username: 'Admin' }, query), true);
  assert.equal(matchesQuery({ username: 'Admin1' }, query), false);
});

test('buildIdentifierQuery normalizes email identifiers to lowercase', () => {
  const query = buildIdentifierQuery('HRLEADING1@GMAIL.COM');

  assert.equal(matchesQuery({ email: 'hrleading1@gmail.com' }, query), true);
});

test('buildIdentifierQuery matches Bahrain phone numbers with common formatting differences', () => {
  const query = buildIdentifierQuery('35100215');

  assert.equal(matchesQuery({ phone: '+973 3510 0215' }, query), true);
  assert.equal(matchesQuery({ phone: '973 3510 0215' }, query), true);
  assert.equal(matchesQuery({ phone: '+973 3420 9934' }, query), false);
});
