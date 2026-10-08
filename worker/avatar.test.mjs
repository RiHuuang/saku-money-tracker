import assert from "node:assert/strict";
import { validAvatar } from "./avatar.js";

// Real 2 x 3 WebP encodings, generated once with libwebp through sharp.
export const avatar = Buffer.from("UklGRjQAAABXRUJQVlA4ICgAAACwAQCdASoCAAMAAUAmJZgCdLoABDAAAP746n/o+uEWRl/8Buvi2XwA", "base64");
const lossless = Buffer.from("UklGRh4AAABXRUJQVlA4TBEAAAAvAYAAAAfQoDIUq/+BiOh/AAA=", "base64");
assert.equal(validAvatar(avatar), true);
assert.equal(validAvatar(lossless), true);
const transparent = Buffer.from("UklGRlYAAABXRUJQVlA4WAoAAAAQAAAAAQAAAgAAQUxQSAcAAAAAZmZmZmZmAFZQOCAoAAAAsAEAnQEqAgADAAFAJiWYAnS6AAQwAAD++Op/6PrhFkZf/Abr4tl8AA==", "base64");
assert.equal(validAvatar(transparent), true);
assert.equal(validAvatar(avatar.subarray(0, -1)), false);
assert.equal(validAvatar(Buffer.from("RIFFxxxxWEBP")), false);
const oversized = Buffer.from(avatar);
oversized.writeUInt16LE(513, 26);
assert.equal(validAvatar(oversized), false);
const oversizedLossless = Buffer.from(lossless);
oversizedLossless.writeUInt32LE(512, 21);
assert.equal(validAvatar(oversizedLossless), false);
const extended = Buffer.alloc(18);
extended.write("VP8X"); extended.writeUInt32LE(10, 4);
extended.writeUIntLE(1, 12, 3); extended.writeUIntLE(2, 15, 3);
const withCanvas = Buffer.concat([avatar.subarray(0, 12), extended, avatar.subarray(12)]);
withCanvas.writeUInt32LE(withCanvas.length - 8, 4);
assert.equal(validAvatar(withCanvas), true);
withCanvas[20] = 2; // Animation flag must never reach storage.
assert.equal(validAvatar(withCanvas), false);
withCanvas[20] = 0; withCanvas.writeUIntLE(512, 24, 3);
assert.equal(validAvatar(withCanvas), false);
const duplicate = Buffer.concat([avatar, avatar.subarray(12)]);
duplicate.writeUInt32LE(duplicate.length - 8, 4);
assert.equal(validAvatar(duplicate), false);
console.log("Avatar validation: static lossy/lossless, dimensions, truncation, animation and duplicate frames passed");
