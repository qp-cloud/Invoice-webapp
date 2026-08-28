const BUDDHIST_OFFSET = 543;

export const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
] as const;

function parseIso(iso: string): { y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) throw new RangeError(`expected YYYY-MM-DD, got ${iso}`);
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

export function buddhistYear(gregorianYear: number): number {
  return gregorianYear + BUDDHIST_OFFSET;
}

/** `2026-08-29` -> `29/08/2569` (spec §7.3, §19.4). */
export function toBuddhistDisplay(iso: string): string {
  const { y, m, d } = parseIso(iso);
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${buddhistYear(y)}`;
}

/** Gregorian `YYYY-MM` -> `สิงหาคม 2569` (spec §6.4, §16.3). */
export function monthLabelTh(ym: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!match) throw new RangeError(`expected YYYY-MM, got ${ym}`);
  const month = THAI_MONTHS[Number(match[2]) - 1];
  if (!month) throw new RangeError(`bad month in ${ym}`);
  return `${month} ${buddhistYear(Number(match[1]))}`;
}
