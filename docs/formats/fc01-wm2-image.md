# F&C Co. WM2 bitmap mask

Reference: `GARbro/ArcFormats/FC01/ImageWM2.cs`, class `Wm2Format`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/fc01/wm2-image.ts` (`wm2ImageDescriptor`, `wm2ImageFormat`, id
`fc01-wm2-image`).

An eight bit mask whose rows are **patched from a table** rather than stored in order:

| field | offset |
|---|---|
| signature `2.0` and a null | 0 |
| width (`u32`), non zero and at most 0x8000 | 4 |
| height (`u32`), the same limits | 8 |
| table, sixteen bytes a row | 12 |
| pool the row offsets point into | `12 + height * 16` |

`ReadMetaData` reads twelve bytes and accepts the file when both dimensions are non zero and no larger than
0x8000; the depth is always eight and the table is not read until extraction, so a file truncated inside the
table still lists. The port adds one recorded deviation: a pixel count above 256 MiB is declined, where the
reference would simply try to allocate it.

The reference registers its signature as a **four byte word**, `0x00302E32`: the marker is `2.0` followed by
a null, and a file whose fourth byte is anything else is never handed to the format. The port compares all
four bytes for the same reason.

## The four words

Each row of the table is four signed words: a **flag**, the **offset within the row**, the **byte count** and the
**offset of the source in the pool after the table**. A row whose flag is zero is left alone, which is why the
output starts as zeros; a row whose flag is anything else copies `count` bytes from `12 + height * 16 + from` to
`row * width + position`. The flag's value beyond being non-zero is never read, and the other three words of a
zero-flag row are junk — two tests pin both, one of them patching the same mask with flags 1, -1 and 0x7FFFFFFF
and expecting identical output, and another filling a skipped row's fields with 99s.

The pool is shared: a test takes three bytes from pool offset zero for one row and two bytes from offset three
for the next, which overlaps the first range, so the two rows come out as `00 00 11 22` and `44 55 00 00`.

## Reads that reach the end, and writes that do not

The two failure directions are treated differently, because the reference treats them differently:

* the source side uses `Stream.Read`, which is allowed to come up short, so a source range past the end of the
  file copies **nothing** rather than failing. A test points a row at pool offset 100 in a small file and expects
  an all-zero row;
* the destination side writes into a flat array, so a row that would reach past the end of the image throws
  there. The port declines the extraction instead — the same outcome by a different route, and documented as
  such. A test puts four bytes at position two of a two byte wide image.

Rows are packed at the image width, so the bitmap's own four byte padding is the writer's: a three byte wide
test image shows `77 88 99 00` twice, and the padding is not taken from the pool.

## Notes

* The entry is named after the source file with a `bmp` extension, covers the whole stored file and keeps
  `sizeKnown: false`; metadata carries the dimensions and the eight bit depth, and the archive metadata matches.
  The reference declares no extensions and the port matches.
* Zero dimensions, dimensions above 0x8000, a wrong signature and a file shorter than the header are all
  declined.
* The reference has no `Write` at all — the class ends at `Read` — so there is nothing to port for encoding.
