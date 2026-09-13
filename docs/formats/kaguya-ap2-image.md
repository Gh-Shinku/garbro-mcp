# KaGuYa AP-2 image

Reference: `GARbro/ArcFormats/Kaguya/ImageAP.cs`, class `Ap2Format`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/kaguya/ap2-image.ts` (`ap2ImageDescriptor`, `ap2ImageFormat`, id
`kaguya-ap2-image`).

| field | offset |
|---|---|
| signature `AP-2` | 0 |
| origin x (`i32`) | 4 |
| origin y (`i32`) | 8 |
| width (`u32`) | 0xC |
| height (`u32`) | 0x10 |
| never read here — the depth in AP-3 | 0x14 |
| pixels, top row first | 0x18 |

## Four bytes the reader walks past

The metadata read covers twenty bytes and then the reader seeks to **0x18**, which leaves a four byte hole at
0x14 that this format never looks at. That is not simply an oversight to be tidied away: `Ap3Format` in the same
file reads a **depth** from exactly that offset, so the family shares one layout and AP-2 is the member that
ignores part of it. The port skips the bytes too, and a test extracts the same file with zeros and with a
recognisable junk pattern there and asserts the two outputs are identical — because a friendlier reader might
have decided that a gap of exactly four bytes is a field.

## The family at a glance

Four formats live in one file and they disagree about almost everything, so this table is worth keeping:

| tag | marker | header | rows | depth |
|---|---|---|---|---|
| `AP` | `AP` | 12 | **bottom up**, reversed | 24 or 32, four bytes each |
| `AP-0` | `AP-0` | 12 | top down | always 8 grayscale |
| `AP-2` | `AP-2` | 0x18 | top down | always 32 |
| `AP-3` | `AP-3` | 0x18 | top down | 8, 24 or 32 from 0x14 |

The two `AP` and `AP-0` entries are the ones to keep apart: same header length, opposite row order, and each
one's reader is a different `ImageData` factory. AO, ported separately, is the base class's reader with an
extended header.

## Reading and output

The pixel buffer is read in one call and compared with its own length, so a short stream throws
`EndOfStreamException` rather than being zero-filled, and bytes after the pixels are never noticed. The output
is a **top down** thirty two bit bitmap (`CreateFlipped`, so a positive height) with the pixels in storage
order.

Zero dimensions are accepted — a zero length read always succeeds — so a file of exactly the metadata size
extracts to a bare bitmap header. The only dimension rule is the 0x8000 ceiling.

## Notes

* The declared extension is `alp`; it is not a gate, and the signature is a full four bytes, so this format's
  probe is a genuine content check.
* Because the extraction gains a header, `sizeKnown` is false.
* `Write` throws `NotImplementedException` in the reference, so encoding is out of scope.
