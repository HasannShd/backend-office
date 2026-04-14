const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getTokenFromRequest,
  validatePasswordStrength,
} = require('../utils/auth-security');

test('getTokenFromRequest prefers bearer tokens', () => {
  const token = getTokenFromRequest({
    headers: {
      authorization: 'Bearer api-token',
      cookie: 'lte_admin_token=admin-cookie',
      'x-auth-scope': 'admin',
    },
  });

  assert.equal(token, 'api-token');
});

test('getTokenFromRequest respects scoped auth cookies', () => {
  const token = getTokenFromRequest({
    headers: {
      cookie: 'lte_user_token=user-cookie; lte_staff_token=staff-cookie; lte_admin_token=admin-cookie',
      'x-auth-scope': 'sales_staff',
    },
  });

  assert.equal(token, 'staff-cookie');
});

test('getTokenFromRequest falls back across cookies when no scope is provided', () => {
  const token = getTokenFromRequest({
    headers: {
      cookie: 'lte_user_token=user-cookie',
    },
  });

  assert.equal(token, 'user-cookie');
});

test('validatePasswordStrength accepts strong passwords', () => {
  assert.equal(validatePasswordStrength('StrongPass1!'), null);
});

test('validatePasswordStrength rejects weak passwords with specific guidance', () => {
  assert.equal(
    validatePasswordStrength('weakpass'),
    'Password must be at least 10 characters.'
  );
  assert.equal(
    validatePasswordStrength('lowercaseonly1!'),
    'Password must include an uppercase letter.'
  );
});
