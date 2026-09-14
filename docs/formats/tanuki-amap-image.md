# TanukiSoft bitmap

Reference: `GARbro/ArcFormats/TanukiSoft/ImageAF.cs`, class `AmapFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/tanuki/amap-image.ts` (`tanukiAmapImageDescriptor`,
`tanukiAmapImageFormat`, id `tanuki-amap-image`).

A **grey bitmap**: the file starts with `AMAP` (the reference's word `0x50414D41`), then a twenty byte
header whose width (`0x04`, word) and height (`0x06`, word) are followed at `0x10` by the length the
compressed body unpacks to. The body from `0x14` is the library's **default LZSS stream**, which the
reference reimplements inline: a 0x1000 byte window starting at `0xFEE`, a control byte whose bits are
read from the least significant one upwards, a **set** bit standing for a literal byte and a clear one
for a back reference stored as a pair of bytes — the low byte first, the high byte's **low** nibble
reversing into the length (`3 + (~hi & 0xF)`) and its high nibble completing the twelve bit offset. The
port uses the shared decoder for it.

Details worth recording:

* the reference checks the unpacked length against nothing, but the image layer it hands the buffer to
  needs a whole image, so a length below `width * height` fails there. The port treats such a body as
  not this format in `readLayout` — a header promising less than the image is not detected at all;
* the buffer is `unpackedSize` bytes long and only its first `width * height` bytes reach the bitmap, so
  a longer stream is trimmed;
* a stream that ends early is the one place the port is looser than the reference: the reference's loop
  stops at end of file and returns the bytes it has, which then fails in the image layer, while the
  port's decoder fills the rest of the requested length with zeros and yields a partly blank bitmap. A
  documented deviation on malformed input;
* the image is handed over as a **top down** eight bit Windows bitmap with the grey ramp palette, which
  is what the reference names (`Gray8`, with no flip).

The tests cover the marker and header, the grey metadata and the `af` extension, a literal body, a back
reference to the byte just written, a reference that reads bytes the match itself writes (the cycling
run), the trimming of a longer stream, and the entry name.
