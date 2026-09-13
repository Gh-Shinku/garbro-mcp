# h.m.p CBF bitmap

Reference: `GARbro/Legacy/hmp/ImageCBF.cs`, class `CbfFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/hmp/cbf-image.ts` (`cbfImageDescriptor`, `cbfImageFormat`, id
`hmp-cbf-image`).

An **uncompressed 16 bit 555 bitmap**. The registry signature `0x432D414D` is `"MA-C"` — the first four
characters of the header text `MA-CBF` that `ReadMetaData` compares, so the signature and the text overlap in
the same way the Kurumi and AnotherRoom ports do:

| field | offset |
|---|---|
| `MA-CBF` (28 byte header) | 0 |
| eight unread bytes | 0x1C |
| width (`u32`) | 0x10 |
| height (`u32`) | 0x14 |
| BGR555 pixels | 0x24 |

The gap between the end of the header that `ReadMetaData` reads and the pixel offset is the notable detail: the
eight bytes at `0x1C..0x23` are never read by either method. A test fills them with a marker and asserts the
decoded pixels come from `0x24`, using a pixel pattern that does not contain that marker byte so the check
cannot pass by coincidence.

The port exposes the resource as a single entry:

* the pixels are stored raw, so `Read` copies them and `ImageData.CreateFlipped` stores the rows **bottom up**;
  the shared `writeBmp16` helper writes them with a **positive** height and keeps the stored 555 values rather
  than widening them. This is the third user of that writer, after MBP and GR1. Odd widths exercise the row
  padding: a three pixel row is six stored bytes inside an eight byte bitmap row;
* `Read` ignores the count returned by the stream, so a file whose pixel data is exhausted gives the zero
  filled buffer the reference allocated rather than an error. `readAt` in this repository throws on a short
  read, so the port clamps explicitly and zero fills the remainder — the same manual clamp the Masys and Leaf
  W ports needed. A header with no pixel data at all therefore decodes to a completely zeroed image, which is
  faithful and which a test pins;
* the entry is named after the source file with a `bmp` extension, covers the whole stored file, and keeps
  `sizeKnown: false` because a bitmap header is written around the copied pixels;
* entry metadata carries `type: "image"`, width, height and `bitsPerPixel: 15` — the source depth, while the
  bitmap itself is sixteen bit; the archive metadata records `image: "bmp"` and the dimensions.

Declines, all tested: a wrong header text (only the sixth character is changed, so the signature still
matches), a zero width or height (the reference would accept an empty image) and a file that stops inside the
header.

The same reference file also declares a `ResourceAlias` mapping the extension `NE` to `WAV`. That is an
extension alias rather than a format, and this repository does not model aliases, so it is out of scope.

GARbro's `Write` throws `NotImplementedException`, so encoding and archive creation are out of scope. The
descriptor registers no extension, matching the reference, which tests the signature instead.
