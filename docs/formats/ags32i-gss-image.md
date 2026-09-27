# AGS32i engine encrypted bitmap

Reference: `GARbro/Legacy/Ags32i/ImageGSS.cs`, class `GssFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/ags32i/gss-image.ts` (`gssImageDescriptor`, `gssImageFormat`,
id `ags32i-gss-image`).

A standalone image resource: an encrypted, zlib-compressed bitmap. The reference declares the
signature list `{ 0x20575A52, 0x20574242, 0x20574346, 0 }`, whose first three words are the
**encrypted `GSS\0` tag** for the keys shipped with the three supported titles — the key is recovered
as `key = storedWord ^ 0x00535347`, and the commented-out `DefaultKey` in the reference
(`0x20040915`) is exactly the first of them.

The layout after decryption with `Ags32Transform` (the same cipher the audio opener uses, exported
from `ags32i/wav-audio.ts` as `decryptAgs32`):

| Offset | Meaning |
|--------|---------|
| `0x00` | `GSS\0` |
| `0x04` | unpacked (bitmap) size, `i32`, must be positive |
| `0x08` | zlib stream of the bitmap |

Inside the decompressed bitmap, the header carries `header_length` (`i32@0x00`, read back as the data
offset), width (`u32@0x04`), height (`u32@0x08`) and bits per pixel (`i16@0x0E`); the reference
requires `0 < header_length < unpacked_size`.

The port exposes the resource as a single entry:

* detection needs one of the four stored words, a surviving `GSS\0` tag after decryption, a positive
  unpacked size, a payload that inflates and a header length inside the required range;
* the entry is named after the source file with a `bmp` extension and is flagged encrypted;
* `sizeKnown` is false because the payload is decrypted and inflated, so its length differs from the
  source;
* extraction reads the **places of the picture** out of the decompressed stream behind the count of the places of
  the file its head names, of three or four places of a colour to a pixel, and turns the rows of the file over,
  since the reference stands of `ImageData.CreateFlipped`;
* entry metadata carries `type: "image"` plus the width, height and bit depth, and the archive
  metadata records the same values with `image: "bmp"`.

## Deviations

* The reference streams the inflation and only ever reads the parts it needs; the port inflates the
  whole payload eagerly (detection runs only for files whose first four bytes match one of the four
  words, so the cost is bounded).
* The reference validates that the bit depth is 24 or 32 when it builds pixels; the port stands of the same
  validation and turns a picture of any other count away on extraction.
* A picture whose places stand short of the count its head names is turned away on extraction, where the reference
  throws while reading the pixels.
`GssFormat.Read` reads the places of the picture: they stand behind the count of the places of the file the head of the
bitmap names, of three or four places of a colour to a pixel, and the rows of the file stand bottom up, since the
reference stands of `ImageData.CreateFlipped`. The port hands them over as a bitmap of the count of places of a colour
the head names, and turns a picture of any other count away. Archive creation and image writing are out of scope.
