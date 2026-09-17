# Zyx METAL image format

Reference: `GARbro/ArcFormats/Zyx/ImageMTL.cs`, classes `MtlFormat` and `MtlReader`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/zyx/mtl-image.ts` (`zyxMtlImageDescriptor`, `zyxMtlImageFormat`, id
`zyx-mtl-image`, `readMtlLayout`, `unpackMtl`).

The file begins with the five letters `METAL`, of which only the first four are the signature word GARbro
registers. `ReadMetaData` requires the word at `0x10` to be `0x28` and the byte at `0x15` not to be nothing,
then reads a name of its own declared length, requires the word `0xC` behind it and a sane count of frames.
One twenty four byte record per frame follows, and behind that index stands the walk of pixels. The
measurements are read as words at `0x20` and `0x24` and the depth is always reported as thirty two bits. The
reference reads the head, the name and the index but never looks inside the records themselves.

The pixels are a walk of six kinds of command, told apart by the high bits of a control byte:

| control | what it does |
| --- | --- |
| below `0x80` | that many pixels stand in the stream themselves, three bytes each |
| `0x80` to `0xBF` | that many pixels are left as they stand, which the empty buffer holds as nothing — a run of transparency |
| `0xC0` to `0xDF` | one pixel stands in the stream and is repeated, one more time than the control says |
| `0xE0` to `0xEF` | one pixel is copied from a neighbour, told apart by the two low bits: the left, above, above left and above right |
| `0xF0` and above | a run of pixels is copied from a place behind, whose distance and count stand in the stream |

The runs of the last kind read their distance first and their count second. Their lowest bit says whether the
distance is a byte or a word, and of the two bits behind it, bit three says whether a count stands in the
stream at all — without it the count is one — and bit one whether that count is a byte or a word. A copy is
made a byte at a time, so a run whose source stands behind its destination repeats what it writes. The
reference's own `Binary.CopyOverlapped` does the same.

A command that reaches outside the picture is refused, as is a stream that stops where a command or a pixel is
wanted; the reference's own array reads and writes answer both with an exception (documented deviations in the
message only). A picture whose pixels would take more than 256 megabytes is refused rather than allocated.
The write path of the reference throws `NotImplementedException`, so this is a read only format.

The tests cover the head the reference reads and each of its declines — the word at `0x10`, the byte at
`0x15`, the name length, the word behind the name and the count of frames; the measurements and the walk
offset behind the frame index; a picture written out again thirty two bits a pixel; a head that is not all
there and a walk that stops before the picture is whole; and of the walk itself a run of transparency, a
repeated pixel, each of the four neighbours, a run with an eight bit distance, a run with a sixteen bit
distance and count, and the refusal of a command that reaches outside the picture.
