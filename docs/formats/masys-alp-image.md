# Masys ALP alpha channel bitmap

Reference: `GARbro/ArcFormats/Masys/ImageALP.cs`, class `AlpFormat`, tag `ALP/MEGU`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/masys/alp-image.ts` (`masysAlpImageDescriptor`,
`masysAlpImageFormat`, id `masys-alp-image`).

The third of GARbro's three `AlpFormat` classes, and the only compressed one: an **eight bit grey alpha
mask stored as a control byte stream** behind a twenty one byte header. The signature is `ALPd`.

| field | offset |
|---|---|
| signature `ALPd` | 0 |
| reserved, must be zero | 4 |
| width (u32) | 5 |
| height (u32) | 9 |
| decompressed size (u32) | 0x11 |
| control stream | 0x15 |

Each control byte carries a six bit sample in its low bits. With bit 7 **set** the sample is followed by
a little endian word and repeated that many times; with bit 7 **clear** the byte yields a single sample.
The sample value is `(byte)((control & 0x7F) * 0xFF / 0x40)` — the same six bit expansion the BeF
`ALP/BeF` port uses, and subject to the same surprises:

* the arithmetic is done in `int` and truncated to a byte, so values above `0x40` **wrap** rather than
  saturate. `0x7F` yields 250, not 255, and only exactly `0x40` reaches full scale;
* the control byte's mask is seven bits, so the run flag never leaks into the sample.

Two behaviours of the reference are reproduced deliberately:

* the loop stops when the output is full, so a stream that ends early **leaves the remaining samples
  zero** — the reference breaks on end of input and the buffer was zero initialised. A test covers a
  stream that fills only half the image;
* failure timing. The reference reads the whole header in `ReadMetaData`, so listing an image with a
  broken control stream succeeds and only extraction throws. The port matches that: a run that would
  overrun the image is declined in `openEntry`, not in `detect`, and the test asserts exactly that
  placement.

Deviations, all defensive: the decompressed size must **equal** the dimensions' product (the reference
would hand a mismatched array to `ImageData.Create` and throw), it is capped at 64 MiB so a hostile header
cannot ask for an unbounded allocation, and the signature is re-checked in `detect` although the reference
relies on the registry gate alone.

The port exposes the resource as a single entry:

* the entry is named after the source file with a `bmp` extension, covers the control stream, is flagged
  `compressed: true` and sets `sizeKnown: false` because the extracted length differs from the stored one;
* extraction writes an eight bit grey bitmap with `writeBmp8`. This port reads through `ImageData.Create`,
  so the rows run **top down** and the bitmap carries a negative height — the opposite of the GameSystem
  `ALP/GAMESYSTEM` port, which uses `CreateFlipped`;
* entry metadata carries `type: "image"` with the dimensions and bits per pixel, and the archive metadata
  records `image: "bmp"`, the dimensions, the bits per pixel and the decompressed size.

Encoding and archive creation are out of scope.
