# KaGuYa AP-0 grayscale image

Reference: `GARbro/ArcFormats/Kaguya/ImageAP.cs`, class `Ap0Format`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/kaguya/ap0-image.ts` (`ap0ImageDescriptor`, `ap0ImageFormat`, id
`kaguya-ap0-image`).

| field | offset |
|---|---|
| signature `AP-0` | 0 |
| width (`u32`) | 4 |
| height (`u32`) | 8 |
| pixels, top row first | 0xC |

## A sibling, not a subclass

This is the third format in `ImageAP.cs`, but it does not extend `ApFormat`: it has its own reader, its own
signature and **no depth field at all**, which is why its dimensions sit at 4 and 8 rather than at 2 and 6. The
only shared rule is the 0x8000 dimension ceiling, which the port imports as a constant rather than copying.
This format is always eight bit grayscale.

## Rows go the other way round from AP

The base format uses `ImageData.Create` and builds its buffer bottom up, so its reader has to reverse the
stored rows. This one uses **`CreateFlipped`**, which is a bitmap's own convention, and hands the pixels over
as they were read — so the stored rows are **top down** and nothing is reversed. A test pins the block in
storage order, and the two formats make a useful pair to read together: the difference is exactly which of the
two `ImageData` factories the reference calls.

The reference reads its whole buffer in one call and throws `EndOfStreamException` when it comes up short, so a
truncated file lists and then fails rather than being zero-filled. It does **not** compare the file's length, so
bytes after the pixels are simply never read — the opposite of SFG, where the exact length is the whole
identity, and a test covers both directions.

## Output

The bitmap is eight bit with the standard grey ramp palette, which a grayscale image wants: entry zero is
black and entry 255 is white, both with a zero fourth byte. The stored stride is one byte a pixel, so the writer
pads the rows out to four.

## Notes

* The declared extension is `alp`, which `ApFormat` also lists; neither is a gate.
* Because the extraction gains a header and a palette, `sizeKnown` is false.
* `Write` throws `NotImplementedException` in the reference, so encoding is out of scope.
* `Ap2Format` and `Ap3Format` in the same file are still to be ported.
