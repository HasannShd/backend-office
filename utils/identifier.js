const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const onlyDigits = (value) => String(value || '').replace(/\D/g, '');

const digitsToLoosePhonePattern = (digits) => digits.split('').map(escapeRegExp).join('\\D*');

const buildPhoneRegex = (identifier) => {
  const digits = onlyDigits(identifier);
  if (digits.length < 6) return null;

  if (digits.startsWith('973') && digits.length > 3) {
    const localDigits = digits.slice(3);
    return new RegExp(`^\\D*(?:\\+?973\\D*)?${digitsToLoosePhonePattern(localDigits)}\\D*$`);
  }

  return new RegExp(`^\\D*(?:\\+?973\\D*)?${digitsToLoosePhonePattern(digits)}\\D*$`);
};

const buildIdentifierQuery = (identifier) => {
  if (!identifier) return null;

  const normalizedIdentifier = String(identifier).trim();
  if (!normalizedIdentifier) return null;

  const normalizedEmailIdentifier = normalizedIdentifier.toLowerCase();
  const usernameRegex = new RegExp(`^${escapeRegExp(normalizedIdentifier)}$`, 'i');
  const phoneRegex = buildPhoneRegex(normalizedIdentifier);

  const query = {
    $or: [
      { username: usernameRegex },
      { email: normalizedEmailIdentifier },
      { phone: normalizedIdentifier },
    ],
  };

  if (phoneRegex) {
    query.$or.push({ phone: phoneRegex });
  }

  return query;
};

module.exports = {
  buildIdentifierQuery,
};
