export function formatPlayerLocalTime(
  utcOffsetMinutes: number | undefined,
  now = Date.now(),
): string | undefined {
  if (
    utcOffsetMinutes === undefined ||
    !Number.isInteger(utcOffsetMinutes) ||
    utcOffsetMinutes < -14 * 60 ||
    utcOffsetMinutes > 14 * 60
  ) {
    return undefined;
  }
  const shifted = new Date(now + utcOffsetMinutes * 60_000);
  return `${String(shifted.getUTCHours()).padStart(2, '0')}:${String(
    shifted.getUTCMinutes(),
  ).padStart(2, '0')}`;
}

export function formatUtcOffset(utcOffsetMinutes: number): string {
  const sign = utcOffsetMinutes >= 0 ? '+' : '−';
  const absolute = Math.abs(utcOffsetMinutes);
  return `UTC${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(
    absolute % 60,
  ).padStart(2, '0')}`;
}
