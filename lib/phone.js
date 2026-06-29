function normalizeGhanaNumber(raw) {
  if (raw === null || raw === undefined) {
    return { valid: false, reason: 'missing', formatted: null };
  }

  const trimmed = String(raw).trim();
  if (trimmed === '') {
    return { valid: false, reason: 'missing', formatted: null };
  }

  let digits = trimmed.replace(/[\s\-()]/g, '');

  if (digits.startsWith('+')) digits = digits.slice(1);

  if (!/^\d+$/.test(digits)) {
    return { valid: false, reason: 'non_numeric', formatted: null, original: trimmed };
  }

  if (digits.startsWith('233') && digits.length === 12) {
    return { valid: true, reason: null, formatted: digits };
  }

  if (digits.length === 10 && digits.startsWith('0')) {
    return { valid: true, reason: null, formatted: '233' + digits.slice(1) };
  }

  if (digits.length === 9 && /^[2-9]/.test(digits)) {
    return { valid: true, reason: null, formatted: '233' + digits };
  }

  return { valid: false, reason: 'malformed', formatted: null, original: trimmed };
}

module.exports = { normalizeGhanaNumber };
