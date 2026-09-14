# AGSI tiled image

Reference: `GARbro/ArcFormats/FC01/ImageTIL.cs`, class `TilFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/fc01/til-image.ts` (`fc01TilImageDescriptor`, `fc01TilImageFormat`,
id `fc01-til-image`).

A **thirty two bit image stored as tiles of records**. The file starts with `TIL0` (the reference's word
`0x304C4954`), then the width (`0x04`, word), the height (`0x08`, word) and the two tile sizes (`0x0C` and
`0x10`, words), so the records begin at `0x14`. The reference divides both dimensions by the tile size with
**truncation**, walks the tiles from left to right and top to bottom, and leaves whatever remainder there is
blank: five pixels in tiles of two leave the fifth column untouched, which a test pins down.

Each **row of each tile** owns one record:

| field | size |
|---|---|
| distance to the next record | `u32` |
| flag | `i32` |
| patch offset, in four byte pixels | `i32`, only when the flag is not zero |
| patch length, in four byte pixels | `i32`, only when the flag is not zero |
| bytes | as many as the length says, only when the flag is not zero |

The first field is the distance to the record behind it — the reference seeks with it rather than assuming the
records are packed together — and the flag is only tested for being zero, in which case that row is left as it
is. A patch writes into the tile's own row, `offset` four byte pixels from the tile's left edge.

Details worth recording:

* the reference does not look at the tile sizes before dividing by them; a zero or negative tile size is refused
  when the header is read, where the reference would fail with a division by zero;
* a patch that would leave the pixel buffer fails with a `GarbroError`, while a patch whose bytes stop before its
  declared length does not: the reference's read returns only what it found and the rest of the row keeps its
  earlier contents, which is what the port copies;
* `ImageData.Create` is called with the width's own stride and no flip, so the bitmap is **top down** with tight
  rows.

The tests cover the marker, the tile size and dimension checks, the metadata, a whole image as one tile, a record
whose flag is zero, a patch of the middle of a row, two tiles side by side, the remainder of a width the tile
size does not divide, the two failure cases and the entry name.
