# Ucom UG image

Reference: `GARbro/Legacy/Ucom/ImageUG.cs`, classes `UgFormat` and `UgReader`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/ucom/ug-image.ts` (`ugImageDescriptor`, `ugImageFormat`, id
`ucom-ug-image`) with `packages/formats/src/ucom/ug-reader.ts` (`UgGraReader`, `verticalGeometry`), on top of
the shared `packages/formats/src/system98/gra-reader.ts`.

This is the fifth and last format in the repository that uses the System98 bit-packed decoder, and the only
one whose scanlines run **vertically**. The reference expresses that as a subclass that copies the decoding
loop and replaces the parts that depend on the axis, and the port mirrors that structure: the base reader's
internals were opened to subclasses, and `UgGraReader` overrides the loop and the flush.

| field | offset |
|---|---|
| left (`u16`) | 0 |
| top (`u16`) | 2 |
| right (`u16`) | 4 |
| bottom (`u16`) | 6 |
| sixteen palette words | 8 |
| bit packed stream | 0x28 |

The header builds a source rectangle rather than a size: the width is **`right - left + 1` column units of
eight pixels** and the height is the inclusive row span `bottom - top + 1`. The zero test is signed, so a
rectangle whose right edge precedes its left edge produces a non-positive width and is declined; the bounds
are 640 by 512 rather than the 640 by 400 of the horizontal readers. The reference gates on the `.UG`
extension *before* reading anything, so the extension check lives in detection and extraction reads the
fields without repeating it.

What the vertical subclass changes, relative to the shared base:

* the ring is `height * 4 * 3` bytes, the opening fill writes `height * 2 + 1` pairs, and the write cursor
  starts at `height * 4`;
* the source selection uses plus four, minus four or a doubling where the horizontal reader doubles, adds one
  or subtracts one. The `-4` repeat-detection branch is the same;
* the run-length branch performs a **single** copy, without the wrap-boundary walk the horizontal reader
  needs;
* the flush reads four words per output row at a stride of the height, advances the write cursor by four
  bytes and shifts the ring by `height * 8` bytes when it finishes, where the horizontal flush moves two rows
  and emits a contiguous run of bytes.

The port emits a **four bit palette bitmap** through `writeBmp4`. The palette words hold blue in the low
nibble, red in the next and green above that, each widened by `0x11` and written as RGB triples, which a test
checks entry by entry. `ImageData.Create` keeps the stored order, so the bitmap takes a negative height.

Declines, all tested: an inverted rectangle, a width past 640 pixels, a height past 512 and a file shorter
than the eight byte header. A file with a valid header but no palette or stream — anything under `0x28` bytes
— still lists and then fails during extraction, which is where the reference's palette read throws.

A note on the strength of these tests, because it differs from the four horizontal formats: those formats are
pinned by a byte sequence traced by hand from the shared decoder's unit tests, while the vertical variant's
output is asserted structurally — output length, palette entries, a non-empty image, determinism across two
decodes, and the truncated-stream case. Tracing the vertical path by hand was not attempted, so its pixel
values are verified only to the extent that the loop is a faithful transcription of the reference.

GARbro's `Write` throws `NotImplementedException`, so encoding and archive creation are out of scope.
