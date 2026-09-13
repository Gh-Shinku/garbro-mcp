# Ocarina RED image

Reference: `GARbro/Legacy/Ocarina/ImageRED.cs`, class `RedFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/ocarina/red-image.ts` (`redImageDescriptor`, `redImageFormat`,
id `ocarina-red-image`).

A bitmap with a **fixed size**: the signature is `RE0` plus a zero byte (`0x00304552` as a little
endian word) and `ReadMetaData` returns the constants `800 x 600`, 32 bits per pixel — the file carries
no dimensions at all, so the pixel area is the same no matter how long the file is.

The pixel stream starts at offset 4 and is decoded word by word:

* a **non-zero** 32 bit word is one pixel (`Bgra32`, i.e. blue, green, red, alpha);
* a **zero** word is a marker: the following byte counts pixels to *skip*, and because the pixel array
  starts zeroed those pixels end up transparent black. The marker itself does not consume a pixel slot.

That is why a fully transparent pixel is never stored directly: the all-zero word is reserved as the
marker, and `ImageData.Create` reports the result top down.

The port exposes the resource as a single entry:

* detection is the signature alone, as in the reference — a file holding nothing but the signature
  yields a fully transparent image rather than being declined;
* decoding stops at the end of the image or the end of the file, and a skip that runs past the last
  pixel simply ends the loop. A short tail of one to three bytes is **ignored** instead of being read
  as a partial word, which is a documented deviation: the reference peeks a single byte and would then
  read a truncated word;
* the entry is named after the source file with a `bmp` extension, covers everything after the
  signature, and sets `sizeKnown: false`, because a bitmap header is prepended and the pixel area is a
  fixed size;
* extraction writes a 32 bit bitmap with a negative height (top-down), and entry metadata carries
  `type: "image"` plus the fixed dimensions, with archive metadata recording `image: "bmp"`.

Pixel encoding and archive creation are out of scope.
