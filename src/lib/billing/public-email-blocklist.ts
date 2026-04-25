/**
 * Public and disposable email domain blocklist.
 *
 * These domains should NEVER trigger domain-match prompts
 * (e.g. "Join the organization tied to your email domain?").
 *
 * The list covers:
 *   - Free consumer webmail (Gmail, Outlook, Yahoo, iCloud, etc.)
 *   - Privacy-forward free providers (ProtonMail, Tutanota, Fastmail)
 *   - Disposable / throwaway providers (mailinator, tempmail, guerrillamail, etc.)
 *
 * All entries are stored lowercase. `isPublicEmailDomain` performs the
 * case-insensitive match.
 */

export const PUBLIC_EMAIL_DOMAINS: ReadonlySet<string> = new Set<string>([
  // Major free webmail
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "ymail.com",
  "yahoo.co.uk",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",

  // Privacy / indie webmail
  "proton.me",
  "protonmail.com",
  "hey.com",
  "fastmail.com",
  "zoho.com",
  "mail.com",
  "gmx.com",
  "gmx.de",
  "gmx.net",
  "yandex.com",
  "yandex.ru",
  "tutanota.com",

  // Disposable / throwaway
  "mailinator.com",
  "tempmail.com",
  "temp-mail.org",
  "10minutemail.com",
  "guerrillamail.com",
  "throwawaymail.com",
  "dispostable.com",
]);

/**
 * Extract the domain portion of an email address.
 * Returns a lowercased, trimmed domain, or `null` if the input is not a
 * valid single-`@` email.
 */
export function getEmailDomain(email: string): string | null {
  if (typeof email !== "string") return null;
  const trimmed = email.trim().toLowerCase();
  if (!trimmed) return null;

  const atIdx = trimmed.lastIndexOf("@");
  if (atIdx <= 0 || atIdx === trimmed.length - 1) return null;

  const domain = trimmed.slice(atIdx + 1).trim();
  if (!domain || domain.includes("@") || domain.includes(" ")) return null;

  return domain;
}

/**
 * Returns `true` if the email's domain is a known public / disposable
 * provider and therefore must NOT be used for domain-based org matching.
 */
export function isPublicEmailDomain(email: string): boolean {
  const domain = getEmailDomain(email);
  if (!domain) return false;
  return PUBLIC_EMAIL_DOMAINS.has(domain);
}
