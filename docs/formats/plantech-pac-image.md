# PLANTECH PAC bitmap

Reference: `GARbro/Legacy/PlanTech/ImagePAC.cs`, class `PacFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/plantech/pac-image.ts` (`plantechPacImageDescriptor`,
`plantechPacImageFormat`, id `plantech-pac-image`).

The decoder for the package that `plantech-pac` (the archive opener from the same directory, `ArcPAC.cs`) lists.
A bitmap that does not start at the beginning of the file:

| field | offset |
|---|---|
| zero signature (the first four bytes must be zero) | 0 |
| a copy of the bitmap's size field | 4 |
| the bitmap, beginning with `BM` | 8 |

`ReadMetaData` reads fourteen bytes, requires the signature to be zero, requires `BM` at offset eight and requires
the size word at four to equal the bitmap's own size word at ten, then parses the rest with the ordinary bitmap
reader over a region starting at eight. **Every bitmap offset is therefore relative to eight**, including the
pixel data offset — and the reader carries that offset in its metadata so the test suite can pin it. One test
inserts ten unused bytes between the header and the pixels and moves `bfOffBits` to match; a port that assumed a
fixed data offset would read the wrong bytes and fail.

## Rows are carried verbatim

The reference computes the row stride as `((width * bitsPerPixel / 8) + 3) & ~3` and passes it to
`ImageData.Create`. That is exactly the stride a bitmap lays its own rows out with, so **the stored bytes are
already in the output layout** and the port writes a header and appends them unchanged. This is the same rule the
West Gate NBMP port follows, and it matters here for a different reason: the stored row padding belongs to the
image the reference hands on, so a writer that repacked packed rows into fresh zero padding would lose bytes that
are part of the answer. A three pixel wide 24 bit test image (nine bytes a row, twelve after padding) fails
against a repacking port, which is how this was noticed: the first version of the port used the shared
`writeBmp24` and lost the padding.

The one exception is the sixteen bit case. The reference reads those words as `Bgr565`, and a plain DIB header
describes sixteen bit words as 555, so the port builds a `BI_BITFIELDS` header through `writeBmp16` and corrects
the two size fields afterwards. Tests read the masks back out of the output (0xF800, 0x07E0, 0x001F) and check
the pixel words are untouched.

## The four depths and the two that are not

Only 8, 16, 24 and 32 bits are accepted, and the mapping is the reference's:

* 8 bits are read as **grey samples and any palette the stored bitmap carries is ignored** — a test stores a red
  and blue palette and expects the grey ramp in the output, so a port that copied the stored palette would fail;
* 16 bits are `Bgr565` as above; 24 and 32 bits keep their byte order.

An unsupported depth still **lists**: the reference throws `InvalidFormatException` while reading, not while
probing, so the port carries the depth in its metadata and fails at extraction. A test uses a 4 bit bitmap to pin
that split, and another stores fewer pixel bytes than the dimensions need, which is also a listing that succeeds
and an extraction that fails because `ReadBytes` throws.

* A mismatched mirrored size word, a marker moved away from offset eight and a non-zero signature are all
  declined; the detection gate is the four zero bytes, which the format re-checks itself rather than trusting
  the registry.
* The entry is named after the source file with a `bmp` extension, covers the whole stored file and keeps
  `sizeKnown: false`; metadata carries the dimensions, the depth and the bitmap's data offset. The reference
  declares no extensions and the port matches.
* `Write` throws `NotImplementedException` in the reference, so encoding is out of scope.

## A fixture note

The three-part detection test was written with `moved[8] = 0x42; moved[9] = 0x4d`, which spells `BM` again — the
same two bytes the fixture had put there. The assertion that this should be declined failed and looked like a
detection bug until the bytes were read back. It now writes `XX`, and the port was right from the start.
