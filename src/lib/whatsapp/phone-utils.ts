/**
 * Sanitize phone number for Meta WhatsApp API.
 * Meta requires digits only — no + prefix, no spaces, no dashes.
 * e.g. "+370 63949836" → "37063949836"
 */
export function sanitizePhoneForMeta(phone: string): string {
  if (!phone) return ''
  return phone.replace(/\D/g, '')
}

/**
 * Normalize phone number by removing all non-digit characters.
 * Used for comparing phone numbers in different formats.
 */
export function normalizePhone(phone: string): string {
  if (!phone) return ''
  return phone.replace(/\D/g, '')
}

/**
 * Compare two phone numbers accounting for trunk prefix differences.
 * e.g. "370063949836" (with trunk 0) matches "37063949836" (without trunk 0)
 * by comparing the last 8 digits.
 */
export function phonesMatch(phone1: string, phone2: string): boolean {
  const n1 = normalizePhone(phone1)
  const n2 = normalizePhone(phone2)
  if (n1 === n2) return true
  if (n1.length >= 8 && n2.length >= 8) {
    return n1.slice(-8) === n2.slice(-8)
  }
  return false
}

/**
 * Validate phone number is E.164-like format (7-15 digits starting with non-zero).
 * Accepts with or without + prefix.
 */
export function isValidE164(phone: string): boolean {
  return /^\+?[1-9]\d{6,14}$/.test(phone)
}

/**
 * Generate plausible phone number variants for retry when Meta's
 * sandbox rejects a number with error #131030 ("not in allowed list").
 *
 * Many countries use a "trunk prefix" 0 for domestic dialing that is
 * meant to be dropped in international format (e.g. Lithuanian
 * "+370 063 949 836" domestically → "+370 63 949 836" international).
 * But some sandboxes register the number with the trunk 0 included,
 * causing sends to the correct international format to fail.
 *
 * This helper yields up to 3 variants:
 *   1. The original sanitized number (first attempt)
 *   2. With a trunk 0 inserted after the country code
 *   3. With a trunk 0 removed after the country code
 *
 * Country-code lengths of 1, 2, and 3 digits are tried because we
 * don't know the user's country ahead of time.
 *
 * @param sanitized - digits-only phone number (from sanitizePhoneForMeta)
 * @returns deduplicated list of variants, original first
 */
export function phoneVariants(sanitized: string): string[] {
  if (!sanitized) return []
  const seen = new Set<string>()
  const push = (v: string) => {
    if (v && !seen.has(v)) seen.add(v)
  }

  // 1. Original
  push(sanitized)

  // 2. Insert a 0 after each plausible country-code length
  for (const ccLen of [1, 2, 3]) {
    if (sanitized.length <= ccLen) continue
    const cc = sanitized.slice(0, ccLen)
    const rest = sanitized.slice(ccLen)
    if (!rest.startsWith('0')) {
      push(cc + '0' + rest)
    }
  }

  // 3. Remove a leading 0 after each plausible country-code length
  for (const ccLen of [1, 2, 3]) {
    if (sanitized.length <= ccLen + 1) continue
    const cc = sanitized.slice(0, ccLen)
    const rest = sanitized.slice(ccLen)
    if (rest.startsWith('0')) {
      push(cc + rest.slice(1))
    }
  }

  return [...seen]
}

/**
 * Returns true when the Meta API error indicates the recipient
 * phone number isn't in the allowed list (sandbox restriction).
 * Detected via error code 131030 or the standard error text.
 */
export function isRecipientNotAllowedError(message: string): boolean {
  return /131030|not in allowed list|not in the allowed list/i.test(message)
}

/**
 * Format phone number for clean UI display.
 * Strips WhatsApp JID suffixes (@s.whatsapp.net, @c.us, etc.) and ensures
 * a consistent international + prefix with readable digit spacing.
 *
 * e.g. "919876543210@s.whatsapp.net" → "+91 98765 43210"
 * e.g. "+14155552671" → "+1 415 555 2671"
 */
export function formatDisplayPhone(phone?: string | null): string {
  if (!phone) return '';
  // Strip JID suffix if present
  let clean = phone.replace(/@(s\.whatsapp\.net|c\.us|g\.us).*$/i, '').trim();

  // If already formatted with spaces or dashes and starts with +, return cleaned
  if (clean.startsWith('+') && /\s|-/.test(clean)) {
    return clean;
  }

  // Extract digits
  const digits = clean.replace(/\D/g, '');
  if (!digits) return clean;

  // Format common lengths
  if (digits.length === 10) {
    // Local 10-digit number
    return `+${digits.slice(0, 5)} ${digits.slice(5)}`;
  } else if (digits.length === 11 && digits.startsWith('1')) {
    // US/Canada: +1 (XXX) XXX-XXXX
    return `+1 ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  } else if (digits.length === 12 && digits.startsWith('91')) {
    // India: +91 XXXXX XXXXX
    return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  } else if (digits.length >= 11 && digits.length <= 15) {
    // Generic international: +CC XXXX XXXXX
    const ccLen = digits.length > 12 ? 3 : 2;
    return `+${digits.slice(0, ccLen)} ${digits.slice(ccLen, ccLen + 4)} ${digits.slice(ccLen + 4)}`;
  }

  return clean.startsWith('+') ? clean : `+${digits}`;
}

export interface ContactDisplayInfo {
  title: string;
  subtitle: string | null;
  initials: string;
}

/**
 * Resolves the primary contact title and formatted subtitle (phone or instagram handle).
 * If a user-saved contact name exists, the name is displayed as the title,
 * and the formatted phone number is shown as the subtitle.
 */
export function getContactDisplay(contact?: {
  name?: string | null;
  phone?: string | null;
  instagram_username?: string | null;
  channel?: string | null;
} | null, fallbackText = 'Unknown'): ContactDisplayInfo {
  if (!contact) {
    return { title: fallbackText, subtitle: null, initials: '?' };
  }

  const isInstagram = contact.channel === 'instagram' || Boolean(contact.instagram_username);
  const formattedPhone = contact.phone ? formatDisplayPhone(contact.phone) : null;
  const igHandle = contact.instagram_username ? `@${contact.instagram_username}` : null;

  const hasExplicitName = Boolean(
    contact.name &&
    contact.name.trim() !== '' &&
    contact.name.trim() !== contact.phone &&
    !contact.name.includes('@s.whatsapp.net') &&
    !contact.name.includes('@c.us')
  );

  if (hasExplicitName) {
    const title = contact.name!.trim();
    const subtitle = isInstagram ? igHandle : formattedPhone;
    const initials = title.charAt(0).toUpperCase();
    return { title, subtitle, initials };
  }

  if (isInstagram && igHandle) {
    return {
      title: igHandle,
      subtitle: contact.name && contact.name !== igHandle ? contact.name : null,
      initials: (contact.instagram_username || 'I').charAt(0).toUpperCase(),
    };
  }

  if (formattedPhone) {
    return {
      title: formattedPhone,
      subtitle: null,
      initials: formattedPhone.replace(/\D/g, '').charAt(0) || '#',
    };
  }

  return {
    title: contact.name || fallbackText,
    subtitle: null,
    initials: (contact.name || fallbackText).charAt(0).toUpperCase(),
  };
}

