// Regenerates the Lipat favicons, web app icons and Play icon from src/brandMark.ts.
// Usage: node scripts/brand-assets.mjs. Android uses the vector drawables in res/drawable instead.
import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";

const source = await readFile(new URL("../src/brandMark.ts", import.meta.url), "utf8");
const shape = (name) => source.match(new RegExp(`${name} = "([^"]+)"`))[1];
const [back, coin, front] = ["markBack", "markCoin", "markFront"].map(shape);
const forest = "#0F2E25", pocket = "#24604D", mint = "#A8E6C1", ivory = "#F4F1E8";

// `height` is the mark's height as a share of the tile; the mark sits a little below centre, under its coin.
function tile(size, { radius = 0, height = 0.59 } = {}) {
  const scale = (size * height) / 154;
  const x = size / 2 - 68 * scale, y = size / 2 - 77 * scale + size * 0.012;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<rect width="${size}" height="${size}" rx="${radius}" fill="${forest}"/>` +
    `<g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${scale.toFixed(4)})">` +
    `<path fill="${pocket}" d="${back}"/><path fill="${mint}" d="${coin}"/><path fill="${ivory}" d="${front}"/></g></svg>`;
}

const png = (svg, path) => sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(path);
const rounded = (size) => tile(size, { radius: size * 0.22 });

await writeFile("public/favicon.svg", tile(64, { radius: 14, height: 0.66 }) + "\n");
await writeFile("landing/assets/favicon.svg", tile(64, { radius: 14, height: 0.66 }) + "\n");
await png(tile(48, { radius: 10, height: 0.66 }), "public/favicon.png");
await png(tile(48, { radius: 10, height: 0.66 }), "landing/assets/favicon.png");
await png(rounded(192), "public/icons/icon-192.png");
await png(rounded(512), "public/icons/icon-512.png");
await png(tile(512, { height: 0.5 }), "public/icons/maskable-512.png"); // Fits the 80% maskable safe zone.
await png(tile(180), "public/icons/apple-touch-icon.png"); // iOS rounds the corners itself.
await png(tile(512, { height: 0.56 }), "docs/brand/play-icon-512.png"); // Play applies its own mask.
console.log("Brand icons written.");
