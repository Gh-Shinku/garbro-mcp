# Rit's image format

Reference: `GARbro/ArcFormats/Rits/ImageHBM.cs`, class `HbmFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).
Implementation: `packages/formats/src/rits/hbm-image.ts` (`hbmImageDescriptor`, `hbmImageFormat`, id
`rits-hbm-image`).

| field | offset |
|---|---|
| marker `HBM` and a null | 0 |
| width (`u32`) | 4 |
| height (`u32`) | 8 |
| flags | 0xC |
| payload — plain | 0x10 |
| four bytes, never read | 0x10 |
| payload — zlib | 0x14 |

## Two flag bits in one byte

The byte at 0x0C carries both properties of the image and nothing else is looked at:

| bit | meaning |
|---|---|
| 0x10 | the payload is zlib compressed |
| 0x20 | the rows are placed from the end of the image |

The bit depth is not stored at all: this format is always sixteen bits per pixel. A test walks every
combination, and two bytes whose other bits are set, to show that only those two bits are read.

## The flipped flag moves rows, not the stream

When 0x20 is set, the reference reads the stream **sequentially** but writes each row into a different slot:
the first row of the file lands in the *last* row of the image. The port keeps a separate cursor for the
stream — reading at an offset derived from the destination would produce an unreversed image, which is exactly
the fault an earlier port (Kaguya AP) had.

Each read asks for exactly one row, and the reference ignores how much it got. So a stream that runs out leaves
the rows it did not reach as zeroes, and because the placement is reversed, a short flipped file leaves the
**top** of the image empty while its bottom row is complete. A test asserts both halves of that.

## Output

`ImageData.Create` means the bitmap is **top down** — a negative height — and the stride the reference computes,
`(2 * width + 3) & ~3`, is already a sixteen bit bitmap's. The stored rows are therefore carried across whole,
padding included, and the header is built directly: `BI_BITFIELDS` at offset 30 and the twelve mask bytes
(`0x7c00`, `0x03e0`, `0x001f`) before the pixels. Repacking through a tighter stride, as the shared writers do,
would drop the padding.

## One deliberate difference

The port caps the inflate at the size the header asks for. The reference fills its buffer and stops reading, so
a stream that decodes *longer* than the bitmap is truncated there; here it fails instead. That is the port's own
guard, and a test records the behaviour.

`Write` throws `NotImplementedException` in the reference.

## Process notes

* The marker is three bytes, like several other formats here; it is registered as three.
* Two fixture faults, both in **my** hex arithmetic rather than in the port: the byte that sets both flags plus
  other bits is `0x3f`, not `0xcf`, because `0xcf` is `0xC0 | 0x0F` and sets neither 0x10 nor 0x20. Both slips
  were caught by the test the fixture was meant to serve, and the corrected case list now includes `0xcf`
  explicitly as a byte that sets no flag at all.
