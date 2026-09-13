# Black Rainbow BMZ compressed bitmap

Reference: `GARbro/ArcFormats/BlackRainbow/ImageBMZ.cs`, class `BmzFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/black-rainbow/bmz-image.ts` (`bmzImageDescriptor`, `bmzImageFormat`, id
`black-rainbow-bmz-image`).

The simplest of the compressed bitmap readers ported here: a **bitmap inside a zlib stream**, behind an eight
byte header holding the signature `ZLC3` and the length of the bitmap that was compressed.

| field | offset |
|---|---|
| signature `ZLC3` | 0 |
| unpacked size (`u32`), read and **never used** | 4 |
| zlib stream | 8 |

The size word is the interesting part. `ReadMetaData` reads the eight byte header and then inflates from where
the stream stands; the size is not compared with anything, and `Read` does not even look at it — it seeks eight
bytes and repeats the inflation. The writer stores the value because it knows it, not because the reader needs
it. The port follows that: the value is carried into the archive metadata for completeness and a test patches
it to `0xdeadbeef` and asserts that the image still decodes and that the metadata reports the bogus value, so
the field is provably not a bound.

The port exposes the resource as a single entry:

* decompression uses the shared `inflateZlibBufferCapped` with a 256 MiB cap, the deviation the PMP, PMW and
  GRA ports document. The reference's `ZLibStream` has no cap, so a file that declares a small size and carries
  a large stream is bounded here but not there;
* the inflated payload is validated with the shared `readBmpMetaData` and trimmed to the bitmap's own `bfSize`
  — a test appends twenty four bytes after the pixels and asserts that the output is the bitmap without them;
* the entry is named after the source file with a `bmp` extension, covers the whole stored file, and is flagged
  `compressed: true` with `sizeKnown: false`;
* entry metadata carries `type: "image"`, the dimensions and the bitmap's bit depth; the archive metadata
  records `image: "bmp"`, `compression: "zlib"`, the dimensions and the `declaredSize` from the header;
* the signature `ZLC3` is registered, and the descriptor declares the `bmz` extension, which is metadata only —
  the reference gates on nothing but the signature.

Deviations, all tested: a payload that inflates to something other than a bitmap is declined, a corrupted
stream, a wrong signature and a file shorter than the header are declined, and a **zero sized bitmap** is
declined even though the metadata helper accepts it, because nothing can be drawn from it.

GARbro *can* write this format: `BmzFormat.Write` builds a bitmap in memory and compresses it at level nine.
Encoding is out of scope, so `create` stays false.
