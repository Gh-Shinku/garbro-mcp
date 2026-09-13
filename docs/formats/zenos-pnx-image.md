# Zenos obfuscated PNG image

Reference: `GARbro/Legacy/Zenos/ImagePNX.cs`, class `PnxFormat` — a subclass of `PngFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/zenos/pnx-image.ts` (`pnxImageDescriptor`, `pnxImageFormat`, id
`zenos-pnx-image`).

An **obfuscated PNG**: the stored signature is `89 50 4E 58`, i.e. a PNG signature whose fourth byte is
`X` instead of `G` (`0x584E5089` as a little endian word). `DeobfuscateStream` builds a prefix stream
from `PngFormat.HeaderBytes` — the standard eight byte PNG signature — followed by the file from offset
**8** to the end. In other words the **first eight bytes are replaced wholesale**, not patched; the four
bytes between the stored signature and the body are never inspected, and everything from offset 8 is an
ordinary PNG.

Because the replacement keeps the body at its original offsets, the chunk offsets do **not** shift (unlike
the P4AG variant, which drops two bytes): the IHDR chunk length sits at `0x08`, the chunk type at `0x0C`,
width at `0x10`, height at `0x14`, bit depth at `0x18` and the colour type at `0x19`.

The port exposes the resource as a single entry:

* detection re-checks the stored signature, the IHDR chunk length and type, non-zero dimensions and the
  colour type (1, 3, 1, 2 and 4 channels for types 0, 2, 3, 4 and 6); the reported bit depth is
  `channels * bitDepth`. As with PSM, re-checking the stored signature is a deliberate deviation, since
  GARbro's registry gate matches the word and a plain PNG handed straight to `Read` would be accepted;
* extraction returns the standard PNG signature followed by the stored body, which is exactly as long as
  the input;
* the entry is named after the source file with a `png` extension, covers everything after the stored
  signature (offset 8), and is flagged `encrypted: true` and `sizeKnown: false`;
* entry metadata carries `type: "image"` plus width, height and bit depth, and the archive metadata
  records `image: "png"` and `encrypted: true`.

Pixel decoding, PNG structure validation beyond the IHDR and archive creation are out of scope.
