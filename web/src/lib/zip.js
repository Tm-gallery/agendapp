// Minimal .zip writer (stored, no compression), to deliver several .ics files at once.
const zipUtf8 = new TextEncoder();

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 3988292384 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 4294967295;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
  }
  return (crc ^ 4294967295) >>> 0;
}

/** Zip archive bytes for `files` ([{ name, data: string | Uint8Array }]). */
export function makeZip(files, date = new Date()) {
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const chunks = [];
  const entries = [];
  let offset = 0;
  const u16 = (v) => [v & 255, (v >> 8) & 255];
  const u32 = (v) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
  for (const file of files) {
    const name = zipUtf8.encode(file.name);
    const data = typeof file.data == "string" ? zipUtf8.encode(file.data) : file.data;
    const crc = crc32(data);
    const header = new Uint8Array([
      80,
      75,
      3,
      4,
      ...u16(20),
      ...u16(2048),
      ...u16(0),
      ...u16(dosTime),
      ...u16(dosDate),
      ...u32(crc),
      ...u32(data.length),
      ...u32(data.length),
      ...u16(name.length),
      ...u16(0),
    ]);
    chunks.push(header, name, data);
    entries.push({ name, crc, size: data.length, offset });
    offset += header.length + name.length + data.length;
  }
  const centralStart = offset;
  for (const entry of entries) {
    const central = new Uint8Array([
      80,
      75,
      1,
      2,
      ...u16(20),
      ...u16(20),
      ...u16(2048),
      ...u16(0),
      ...u16(dosTime),
      ...u16(dosDate),
      ...u32(entry.crc),
      ...u32(entry.size),
      ...u32(entry.size),
      ...u16(entry.name.length),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(0),
      ...u32(entry.offset),
    ]);
    chunks.push(central, entry.name);
    offset += central.length + entry.name.length;
  }
  const centralSize = offset - centralStart;
  chunks.push(
    new Uint8Array([
      80,
      75,
      5,
      6,
      ...u16(0),
      ...u16(0),
      ...u16(entries.length),
      ...u16(entries.length),
      ...u32(centralSize),
      ...u32(centralStart),
      ...u16(0),
    ]),
  );
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const chunk of chunks) {
    out.set(chunk, pos);
    pos += chunk.length;
  }
  return out;
}
