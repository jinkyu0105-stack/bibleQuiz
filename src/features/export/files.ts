// Small format helpers: stored ZIP entries and PNG pHYs. No compression service or dependencies.
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function join(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0; for (const part of parts) { result.set(part, offset); offset += part.length; } return result;
}
export function png300dpi(png: Uint8Array): Uint8Array<ArrayBuffer> {
  const chunk = new Uint8Array(21), view = new DataView(chunk.buffer);
  view.setUint32(0, 9); chunk.set(new TextEncoder().encode("pHYs"), 4);
  view.setUint32(8, 11811); view.setUint32(12, 11811); chunk[16] = 1;
  view.setUint32(17, crc32(chunk.subarray(4, 17)));
  const parts = [png.subarray(0, 8)];
  for (let offset = 8; offset < png.length;) {
    const length = new DataView(png.buffer, png.byteOffset + offset, 4).getUint32(0) + 12;
    const type = new TextDecoder().decode(png.subarray(offset + 4, offset + 8));
    if (type !== "pHYs") parts.push(png.subarray(offset, offset + length));
    if (type === "IHDR") parts.push(chunk);
    offset += length;
  }
  return join(parts);
}
export function pngZip(files: readonly { name: string; bytes: Uint8Array }[]): Uint8Array<ArrayBuffer> {
  const local: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = new TextEncoder().encode(file.name), crc = crc32(file.bytes);
    const header = new Uint8Array(30), h = new DataView(header.buffer);
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x800, true);
    h.setUint16(12, 33, true); h.setUint32(14, crc, true); h.setUint32(18, file.bytes.length, true);
    h.setUint32(22, file.bytes.length, true); h.setUint16(26, name.length, true);
    local.push(header, name, file.bytes);
    const directory = new Uint8Array(46), d = new DataView(directory.buffer);
    d.setUint32(0, 0x02014b50, true); d.setUint16(4, 20, true); d.setUint16(6, 20, true); d.setUint16(8, 0x800, true);
    d.setUint16(14, 33, true); d.setUint32(16, crc, true); d.setUint32(20, file.bytes.length, true);
    d.setUint32(24, file.bytes.length, true); d.setUint16(28, name.length, true); d.setUint32(42, offset, true);
    central.push(directory, name); offset += header.length + name.length + file.bytes.length;
  }
  const end = new Uint8Array(22), e = new DataView(end.buffer), directory = join(central);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, directory.length, true); e.setUint32(16, offset, true);
  return join([...local, directory, end]);
}
export function download(bytes: Uint8Array, type: string, filename: string) {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type }));
  const link = document.createElement("a"); link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove();
  // Keep the URL alive while the browser accepts the download.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
