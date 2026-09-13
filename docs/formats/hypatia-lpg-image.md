# Kogado Studio LPG image

Reference: `GARbro/ArcFormats/Hypatia/ImageLPG.cs`, class `LpgFormat` (in the `GameRes.Formats.Kogado`
namespace, though the file lives under `Hypatia`) (GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/hypatia/lpg-image.ts` (`lpgImageDescriptor`, `lpgImageFormat`, id
`hypatia-lpg-image`).

| field | offset |
|---|---|
| signature, one byte | 0 |
| depth (`i32`) | 4 |
| never read | 8, 0xC |
| width (`u32`) | 0x10 |
| height (`u32`) | 0x14 |
| never read | 0x18 |
| palette, 256 triples | 0x1C |
| image data | 0x31C |

## A one byte signature, so the extension is the identity

`Signature` is one, which on its own would match a great many files, so `ReadMetaData` starts with
`Name.HasExtension("LPG")` and returns null for anything else. The port keeps that split: the **extension gate
lives in the layout reader** (and therefore in detection and in extraction alike), while the byte and the header
fields are checked on their own, so a direct call cannot mistake an unrelated file for this format. A file with
a valid header under another extension is declined, which a test checks.

The header is twenty eight bytes and only three fields of it are ever read: the depth and the two dimensions.
Bytes eight, twelve and 0x18 are never looked at. The depth must be 24 or 32, both dimensions must be non-zero
and at most 0x8000.

## The two depths behave quite differently

**Thirty two bit is not four bytes a pixel.** It stores a palette index and an alpha value, two bytes a pixel,
and the reference expands each into four — the index through the palette, the alpha kept — into a BGRA buffer.
The stored palette is two hundred and fifty six **red-green-blue** triples, so the port swaps each to
blue-green-red with a zero fourth byte on the way into the bitmap's palette. The result is a bottom-up bitmap
with a **positive** height (`CreateFlipped`), and it has no palette of its own because the stored one has been
expanded into the pixels — the output image data starts directly after the header, which is worth stating
because the first version of the test looked for a palette there.

**Twenty four bit is eight bit indexed.** The reference allocates `width * height` bytes, not three times that,
reads the same number, and wraps the result as `Indexed8` with the palette. The port reproduces that, so a
twenty four bit file extracts as an index map built from the **first** `width * height` bytes of its image data
and everything after them is ignored; the metadata still reports the depth the header declared. This is the
reference's own behaviour rather than a reading of the format, and a test pins both halves of it. Both branches
read the reference's stride — one byte a pixel — which the bitmap writer pads out to four, so a two pixel row
arrives as two bytes and two zeroes.

## When things are read, and what that costs

The palette and the pixels are read during **extraction**, not during the metadata read. A file with a valid
header and a truncated palette therefore lists successfully and then fails when the entry is opened, which a
test checks — the same shape as several other formats here.

On the thirty two bit path the reference reads both bytes of each pixel without a length check, so a stream that
ends inside a pixel throws; the port does the same. On the twenty four bit path it reads into a buffer it
already allocated, so a short stream is **not** an error and the missing bytes stay zeroed. Both behaviours are
tested, and they differ only because of how the reference happens to read.

## Notes

* The image is bottom up in both branches and the port passes `bottomUp` rather than reversing anything.
* Because the extraction gains a header and a palette, `sizeKnown` is false.
* `Write` throws `NotImplementedException` in the reference, so encoding is out of scope.
