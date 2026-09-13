# KaGuYa AP-3 image

Reference: `GARbro/ArcFormats/Kaguya/ImageAP.cs`, class `Ap3Format`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/kaguya/ap3-image.ts` (`ap3ImageDescriptor`, `ap3ImageFormat`, id
`kaguya-ap3-image`).

| field | offset |
|---|---|
| signature `AP-3` | 0 |
| origin x (`i32`) | 4 |
| origin y (`i32`) | 8 |
| width (`u32`) | 0xC |
| height (`u32`) | 0x10 |
| depth (`i32`), 8, 24 or 32 | 0x14 |
| pixels, top row first | 0x18 |

## The field its sibling walks past

This format has the same layout as `AP-2` with the four bytes at 0x14 filled in as a **depth** — the exact field
AP-2's reader skips. The two are worth reading together: one file format with two readers, one of which uses
everything and one of which ignores the depth and assumes thirty two. The dimensions are checked before the
depth, and the depth then has to be eight, twenty four or thirty two.

## Three depths, three outputs, no reversal

The depth decides both the stride (`depth / 8 * width`) and the bitmap that comes out:

| depth | stored format | output |
|---|---|---|
| 8 | `Gray8`, no palette in the file | eight bit bitmap with the grey ramp |
| 24 | `Bgr24` | twenty four bit bitmap, rows padded to four bytes |
| 32 | `Bgra32` | thirty two bit bitmap, copied straight through |

All three use `CreateFlipped` with a stride of exactly one row, so **nothing is reversed** in any depth and the
bitmap records the bottom-up convention as a positive height. The eight bit case is the one worth noting: there
is no palette anywhere in the file, and the grey ramp a bitmap needs is supplied by the writer.

## Reading

The pixel buffer is read in one call and compared with its own length, so a short stream throws
`EndOfStreamException` rather than being zero-filled — the same shape as its siblings — and bytes after the
pixels are never noticed.

## The family, complete

Four formats live in `ImageAP.cs` and all four are now ported, alongside AO which extends the base class:

| tag | marker | header | rows | depth |
|---|---|---|---|---|
| `AP` | `AP` | 12 | **bottom up**, reversed | 24 or 32, four bytes each |
| `AP-0` | `AP-0` | 12 | top down | always 8 grayscale |
| `AP-2` | `AP-2` | 0x18 | top down | always 32, ignores 0x14 |
| `AP-3` | `AP-3` | 0x18 | top down | 8, 24 or 32 from 0x14 |

## Notes

* The declared extension is `alp`, which all four list; the signature is a full four bytes, so detection is by
  content.
* Because the extraction gains a header, `sizeKnown` is false.
* `Write` throws `NotImplementedException` in the reference, so encoding is out of scope.
