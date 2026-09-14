# Seraphim CX image

Reference: `GARbro/ArcFormats/Seraphim/ImageSeraph.cs`, class `SeraphCxImage`, which **extends** the three byte
picture of the same file (GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/seraphim/seraph-image.ts` (`seraphimCxImageDescriptor`,
`seraphimCxImageFormat`, id `seraphim-cx-image`).

The header is the header of the three byte picture, read by the very same code and gated by the same six words
and trailing zero (`seraphim-cf-image.md` holds both). The difference is a single number: the reader is built
with a pixel **four** bytes wide instead of three, which turns the same stream of opcodes into a picture of whole
transparent pixels.

Where that number shows:

* a pattern opcode reads four bytes as they stand, or eight when its bit three is set;
* a copy opcode's offset is counted in pixels, so it reaches back four times as far;
* such a copy's length is cut to the pixels that are left in the picture, which is the one place the reference
  keeps a run from overrunning it;
* the rows are flipped and the bitmap written with a negative height, as for the three byte picture.

Because the format extends `CF`, the reference registers it under the **same words**, and its own `Signature` word
is never used: such a picture is found by `CF` first, in the order the reference declares them. The port keeps
that order and reaches this format by asking for it.

The tests cover the words it is found by, a header without a stream, a picture read bottom up into a top down
bitmap of four byte pixels, a row copied from the row above, a repeated run whose count is scaled by the four
bytes of a pixel, a run cut short at the end of the picture, and an opcode the reference does not know.
