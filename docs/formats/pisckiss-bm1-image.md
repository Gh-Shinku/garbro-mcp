# Pisckiss encrypted bitmap

Reference: `GARbro/Legacy/Pisckiss/Image1.cs`, class `Bm1Format`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/pisckiss/bm1-image.ts` (`bm1ImageDescriptor`, `bm1ImageFormat`, id
`pisckiss-bm1-image`).

| field | offset |
|---|---|
| first byte, only bits 0x42 are examined | 0 |
| four bytes carrying both dimensions as nibbles | 1 |
| rows of a bottom up twenty four bit bitmap | 5 |

## The dimensions are one nibble stream cut in half

There is no signature and the header is five bytes, so the whole identity of the format is how the size is
packed. Each of the four bytes after the first carries **one nibble of the width and one nibble of the height**,
and the pair swaps halves on every byte:

| byte | high half | low half |
|---|---|---|
| 1 | height nibble 0 | width nibble 0 |
| 2 | width nibble 1 | height nibble 1 |
| 3 | height nibble 2 | width nibble 2 |
| 4 | width nibble 3 | height nibble 3 |

Both values are assembled least significant nibble first, so nibble 0 is the bottom four bits, and each
dimension ends up sixteen bits wide. A test pins the layout with a hand written header — a width of 0x0123 and a
height of 0x4567 become `73 26 51 04` — so the packing is asserted against arithmetic rather than against the
port's own reader.

## The first byte is a bitmap filter

The only test on byte zero is that neither **0x40** nor **0x02** is set; every other bit is ignored. Those two
bits are exactly what a plain bitmap has set: `B` is 0x42. A file that starts with `BM` can therefore never pass
this format's probe, which a test demonstrates on a real twenty four bit bitmap of matching length.

## The length has to match, and the rows are already a bitmap's

The stored length is `5 + stride * height` with `stride = (width * 3 + 3) & ~3`, and it must equal the file's
length **exactly**, so a file one byte out is not recognised at all. A test also covers a width whose rows need
padding: three pixels a row is nine bytes, stored as twelve, and the three padding bytes of every row are
carried through to the output rather than recomputed — the stored stride already *is* the bitmap stride, so the
row block is copied verbatim and only a header is prepended. Repacking through a tighter stride would silently
drop the padding, which is what an earlier version of the port did until the test caught it.

The reference computes that length in a thirty two bit integer, so a very large pair of dimensions wraps; the
port reproduces the wrap with `>>> 0` and such a file simply fails the length comparison.

The rows are bottom up under a **positive** height — the `CreateFlipped` convention — so nothing is reversed.
Because the output gains a header the entry reports `sizeKnown: false`. `Write` throws
`NotImplementedException` in the reference.

## A process note

The first version of the port had the two dimensions reading from each other's halves: the helper took an
"even rounds are high" flag and the width was passed the value meant for the height. The hand written
expectation in the test caught it at once. The same test file's own packer had a second, subtler fault — it
decided which half to write by comparing the two nibble *values*, which is ambiguous when they are equal — so
the rule is now written out per byte in both the port and the fixture.
