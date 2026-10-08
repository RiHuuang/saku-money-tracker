// Bound the static WebP container and decoded dimensions without a server decoder.
// https://developers.google.com/speed/webp/docs/riff_container
export function validAvatar(bytes) {
  if (bytes.length < 26 || bytes.length > 3_000_000) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  const uint24 = (offset) => bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
  if (tag(0) !== "RIFF" || tag(8) !== "WEBP" || view.getUint32(4, true) !== bytes.length - 8) return false;
  let offset = 12, canvas, frame, alpha = false;
  const seen = new Set();
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length || seen.size >= 16) return false;
    const kind = tag(offset), size = view.getUint32(offset + 4, true), start = offset + 8, end = start + size;
    if (end + (size & 1) > bytes.length || (size & 1 && bytes[end] !== 0) || seen.has(kind)) return false;
    seen.add(kind);
    if (kind === "VP8X") {
      if (offset !== 12 || size !== 10 || bytes[start] & 0xc3 || uint24(start + 1)) return false;
      canvas = [uint24(start + 4) + 1, uint24(start + 7) + 1];
    } else if (kind === "VP8 " || kind === "VP8L") {
      if (frame) return false;
      if (kind === "VP8 ") {
        if (size <= 10 || bytes[start] & 1 || bytes[start + 3] !== 0x9d || bytes[start + 4] !== 1 || bytes[start + 5] !== 0x2a) return false;
        frame = [view.getUint16(start + 6, true) & 0x3fff, view.getUint16(start + 8, true) & 0x3fff];
      } else {
        if (size <= 5 || bytes[start] !== 0x2f || bytes[start + 4] & 0xe0 || alpha) return false;
        const bits = view.getUint32(start + 1, true);
        frame = [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1];
      }
    } else if (kind === "ALPH") {
      if (!canvas || frame || size < 1) return false;
      alpha = true;
    } else if (!["ICCP", "EXIF", "XMP "].includes(kind) || !canvas) return false;
    offset = end + (size & 1);
  }
  return Boolean(frame && frame.every((side) => side >= 1 && side <= 512) && (!canvas || canvas.every((side, index) => side === frame[index])));
}
