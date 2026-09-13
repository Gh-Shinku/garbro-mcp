# TamaSoft SUR image

Reference: `GARbro/ArcFormats/TamaSoft/ImageSUR.cs`, class `SurFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/tamasoft/sur-image.ts` (`surImageDescriptor`, `surImageFormat`, id
`tamasoft-sur-image`) with its codec in `packages/formats/src/tamasoft/sur-lzss.ts`.

A thirty two bit BGRA image compressed with the engine's own LZSS variant:

| field | offset |
|---|---|
| signature `ESUR` | 0 |
| unused | 4 |
| width (`u32`) | 8 |
| height (`u32`) | 12 |
| unused, sixteen bytes | 0x10 |
| compressed stream | 0x20 |

`ReadMetaData` reads sixteen bytes and takes the dimensions from the last eight; the first eight and the sixteen
bytes between the header and the stream are never read, so the fixture in the tests fills that gap with a marker
and checks it survives. The stream decodes to `width * height * 4` bytes, which `ImageData.Create` keeps rows
**top down** — a bitmap records that with a negative height.

## The one thing that makes this codec its own

`UnpackLzss` carries the comment "differs from a common LZSS implementation by frame offset encoding", and the
difference is exactly one expression. GARbro's shared codec assembles a match offset as
`((high & 0xF0) << 4) | low`, taking the low address bits from the low byte; this variant computes
`(low << 4) | (high >> 4)`, taking the **high** address bits from the low byte and the low four from the high
nibble of the second byte. The match length (`3 + (high & 0xF)`), the 0x1000 frame, the initial write position
0xFEE and the treatment of the control byte are all identical, so the difference cannot be expressed with the
shared codec's settings. Because it is the first consumer of this variant, the codec lives in the format's
directory, the way the Ankh GRP and uGOS readers do.

Proving that difference needs a token whose two readings disagree. The test emits four literals, which land at
frame offsets 0xFEE to 0xFF1, and then the token `FF 00`. This variant reads it as `(0xFF << 4) | 0` = 0xFF0,
the third literal, `0x33`; GARbro's usual encoding would read the same bytes as `((0x00 & 0xF0) << 4) | 0xFF` =
0x0FF, a frame position nothing has written, and produce zeros. The expected output —
`11 22 33 44 33 44 33 55` — also shows the matched bytes being written back into the frame as they are copied,
since the match's third byte is the `0x33` it emitted first.

## Further notes

* The decoder stops as soon as it has the byte count the image needs; trailing input is never read, which a test
  shows by appending a second well formed token sequence and expecting the same pixels.
* A truncated stream fails extraction rather than being padded: the reference throws `EndOfStreamException`
  while reading a control byte or a token's second byte. Listing still succeeds, because `ReadMetaData` reads
  only the header — a test truncates the stream to eight bytes and pins that split.
* A match is clamped to the remaining output, as in the reference, and every emitted byte goes back into the
  frame whether it came from a literal or a match.
* The entry is named after the source file with a `bmp` extension, covers the whole stored file and keeps
  `sizeKnown: false`; it is marked `compressed`. Entry metadata carries `type: "image"`, the dimensions and the
  depth, and the archive metadata names the `sur-lzss` codec.
* The reference declares no extensions and the port matches; zero dimensions and a short header are declined,
  the first as a documented deviation.
* `Write` throws `NotImplementedException` in the reference, so encoding is out of scope.

## A fixture note

The first version of the match test used control byte `0x4F`, meaning to set bit 5 for the trailing literal, but
`0x4F` has bit **6** set — a clean illustration that these control bytes are worth deriving rather than
guessing. The decoder then wanted another match, ran off the end of an eight byte stream and reported the
truncation that the port is supposed to report for genuinely short files.
