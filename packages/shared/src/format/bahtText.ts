const DIGITS = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
const PLACES = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];

/** Read an integer 0..999999 as Thai words ('' for 0 — caller handles zero). */
function readGroup(n: number): string {
  const str = String(n);
  const len = str.length;
  let out = '';
  for (let i = 0; i < len; i += 1) {
    const d = Number(str[i]);
    const place = len - i - 1; // 0 = units ... 5 = แสน
    if (d === 0) continue;
    if (place === 0 && d === 1 && len > 1) {
      out += 'เอ็ด';
    } else if (place === 1 && d === 1) {
      out += 'สิบ';
    } else if (place === 1 && d === 2) {
      out += 'ยี่สิบ';
    } else {
      out += DIGITS[d]! + PLACES[place]!;
    }
  }
  return out;
}

/** Read a non-negative integer as Thai words. Six-digit groups joined by "ล้าน". */
function readInt(n: number): string {
  if (n === 0) return 'ศูนย์';
  const groups: number[] = [];
  let x = n;
  while (x > 0) {
    groups.push(x % 1_000_000);
    x = Math.floor(x / 1_000_000);
  }
  let out = '';
  for (let i = groups.length - 1; i >= 0; i -= 1) {
    if (groups[i] === 0) continue;
    out += readGroup(groups[i]!) + 'ล้าน'.repeat(i);
  }
  return out;
}

/**
 * Thai baht amount in words, e.g. `12345` satang ->
 * "หนึ่งร้อยยี่สิบสามบาทสี่สิบห้าสตางค์". Whole baht -> "...บาทถ้วน".
 * Negatives get a leading "ลบ".
 */
export function bahtText(satang: number): string {
  const n = Math.round(satang);
  const abs = Math.abs(n);
  const baht = Math.floor(abs / 100);
  const stang = abs % 100;
  return (
    (n < 0 ? 'ลบ' : '') +
    readInt(baht) +
    'บาท' +
    (stang === 0 ? 'ถ้วน' : readInt(stang) + 'สตางค์')
  );
}
