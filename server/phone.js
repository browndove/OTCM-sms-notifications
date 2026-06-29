/**
 * Normalizes Ghanaian phone numbers into Arkesel's expected format: 233XXXXXXXXX
 * Handles common messy spreadsheet inputs:
 *   - "246383343"      (9 digits, leading 0 dropped by Excel)      -> 233246383343
 *   - "0246383343"     (10 digits, standard local format)          -> 233246383343
 *   - "233246383343"   (already has country code)                  -> 233246383343
 *   - "+233246383343"  (already has + country code)                -> 233246383343
 *   - "2472192243"     (10 digits but doesn't start with 0 - typo)  -> flagged invalid
 *   - blank / whitespace-only                                       -> flagged missing
 */

function normalizeGhanaNumber(raw) {
  if (raw === null || raw === undefined) {
    return { valid: false, reason: 'missing', formatted: null };
  }

  const trimmed = String(raw).trim();
  if (trimmed === '') {
    return { valid: false, reason: 'missing', formatted: null };
  }

  // strip spaces, dashes, parens
  let digits = trimmed.replace(/[\s\-()]/g, '');

  // strip leading +
  if (digits.startsWith('+')) digits = digits.slice(1);

  // pure digits only from here on
  if (!/^\d+$/.test(digits)) {
    return { valid: false, reason: 'non_numeric', formatted: null, original: trimmed };
  }

  // Already has country code 233
  if (digits.startsWith('233') && digits.length === 12) {
    return { valid: true, reason: null, formatted: digits };
  }

  // Standard local format: 0XXXXXXXXX (10 digits)
  if (digits.length === 10 && digits.startsWith('0')) {
    return { valid: true, reason: null, formatted: '233' + digits.slice(1) };
  }

  // Excel dropped the leading 0: 9 digits, e.g. 246383343
  if (digits.length === 9 && /^[2-9]/.test(digits)) {
    return { valid: true, reason: null, formatted: '233' + digits };
  }

  // Anything else (wrong length, malformed) - flag for manual review
  return { valid: false, reason: 'malformed', formatted: null, original: trimmed };
}

module.exports = { normalizeGhanaNumber };
