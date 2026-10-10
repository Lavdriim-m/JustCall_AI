/** Phone number helpers focused on Switzerland (E.164). */

/**
 * Normalises user input to E.164. Swiss national formats ("079 123 45 67", "0041 79 …")
 * are converted to +41…; other international numbers must start with + or 00.
 * Returns null when the input cannot be a valid number.
 */
export function toE164(input: string | null | undefined, defaultCountry: "CH" = "CH"): string | null {
  if (!input) return null;
  let s = input.trim().replace(/[\s\-/().]/g, "");
  if (!s) return null;
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  if (!s.startsWith("+")) {
    if (defaultCountry === "CH" && /^0\d{9}$/.test(s)) s = `+41${s.slice(1)}`;
    else if (/^41\d{9}$/.test(s)) s = `+${s}`;
    else return null;
  }
  // +41 0 79… → +41 79…
  s = s.replace(/^\+410/, "+41");
  if (!/^\+[1-9]\d{6,14}$/.test(s)) return null;
  if (s.startsWith("+41") && s.length !== 12) return null;
  return s;
}

/** Swiss mobile numbers: 075–079 (and 074 for some providers). */
export function isSwissMobile(e164: string | null | undefined): boolean {
  if (!e164) return false;
  return /^\+417[4-9]\d{7}$/.test(e164);
}

/** Whether we can reasonably send an SMS to this number. */
export function canReceiveSms(e164: string | null | undefined): boolean {
  if (!e164) return false;
  if (e164.startsWith("+41")) return isSwissMobile(e164);
  // Outside Switzerland we cannot tell mobile and landline apart without a carrier lookup.
  return /^\+[1-9]\d{6,14}$/.test(e164);
}

/** "+41791234567" → "079 123 45 67" */
export function formatSwissNumber(e164: string | null | undefined): string {
  if (!e164) return "";
  const m = /^\+41(\d{2})(\d{3})(\d{2})(\d{2})$/.exec(e164);
  if (!m) return e164;
  return `0${m[1]} ${m[2]} ${m[3]} ${m[4]}`;
}

/** Whether a caller ID looks anonymous / withheld (Twilio uses values like "anonymous" or "+266696687"). */
export function isAnonymousCaller(from: string | null | undefined): boolean {
  if (!from) return true;
  const f = from.toLowerCase();
  return (
    f === "anonymous" ||
    f === "unknown" ||
    f === "restricted" ||
    f === "private" ||
    f === "+266696687" ||
    f === "+7378742833" ||
    f === "+2562533" ||
    f === "+86282452253"
  );
}
