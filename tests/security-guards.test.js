const test = require('node:test');
const assert = require('node:assert/strict');

const { privateDataHeaders, rejectUnsafeMongoKeys } = require('../middleware/security-guards');

const createResponse = () => {
  const headers = {};
  return {
    statusCode: 200,
    payload: null,
    headers,
    setHeader(key, value) {
      headers[key] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
};

test('privateDataHeaders marks private API responses as no-store and noindex', () => {
  const req = { path: '/api/admin-portal/clients' };
  const res = createResponse();
  let nextCalled = false;

  privateDataHeaders(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.headers['Cache-Control'], 'no-store, no-cache, must-revalidate, private');
  assert.equal(res.headers['X-Robots-Tag'], 'noindex, nofollow, noarchive');
});

test('privateDataHeaders leaves public API responses cacheable by default', () => {
  const req = { path: '/api/products' };
  const res = createResponse();

  privateDataHeaders(req, res, () => {});

  assert.equal(res.headers['Cache-Control'], undefined);
  assert.equal(res.headers['X-Robots-Tag'], undefined);
});

test('rejectUnsafeMongoKeys rejects operator-style request keys', () => {
  const req = { body: { email: { $ne: '' } }, query: {}, params: {} };
  const res = createResponse();
  let nextCalled = false;

  rejectUnsafeMongoKeys(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.payload, { ok: false, message: 'Invalid request payload.' });
});

test('rejectUnsafeMongoKeys accepts ordinary request payloads', () => {
  const req = { body: { email: 'client@example.com', nested: { name: 'Client' } }, query: {}, params: {} };
  const res = createResponse();
  let nextCalled = false;

  rejectUnsafeMongoKeys(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
});
