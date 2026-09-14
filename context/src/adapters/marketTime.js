function partsInZone(epochMs, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23'
  });
  return Object.fromEntries(formatter.formatToParts(new Date(epochMs))
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, Number(part.value)]));
}

export function zonedDateTimeToIso({ year, month, day, hour = 0, minute = 0, second = 0, timeZone = 'America/New_York' } = {}) {
  const targetWallUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  if (![year, month, day, hour, minute, second].every(Number.isFinite)) return null;
  let guess = targetWallUtc;
  for (let index = 0; index < 3; index += 1) {
    const p = partsInZone(guess, timeZone);
    const observedWallUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    guess += targetWallUtc - observedWallUtc;
  }
  return new Date(guess).toISOString();
}

export function compactTimestampToIso(value, { timeZone = 'America/New_York' } = {}) {
  const text = String(value ?? '').trim();
  const utc = text.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (utc) return new Date(Date.UTC(+utc[1], +utc[2] - 1, +utc[3], +utc[4], +utc[5], +utc[6])).toISOString();
  const local = text.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/);
  if (!local) return null;
  return zonedDateTimeToIso({ year: +local[1], month: +local[2], day: +local[3], hour: +local[4], minute: +local[5], second: +local[6], timeZone });
}

export function parseAmPm(value) {
  const match = String(value ?? '').trim().toLowerCase().match(/^(\d{1,2}):(\d{2})\s*([ap])\.?m\.?$/);
  if (!match) return null;
  let hour = Number(match[1]) % 12;
  if (match[3] === 'p') hour += 12;
  return { hour, minute: Number(match[2]) };
}
