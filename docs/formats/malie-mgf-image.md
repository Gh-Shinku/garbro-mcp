# Malie MGF image

Reference: `GARbro/ArcFormats/Malie/ImageMGF.cs`, class `MgfFormat extends PngFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/malie/mgf-image.ts` (`mgfImageDescriptor`, `mgfImageFormat`, id
`malie-mgf-image`).

A PNG whose eight byte signature has been overwritten with the engine's tag:

| field | offset |
|---|---|
| tag `MalieGF`, seven characters compared, eight bytes wide | 0 |
| the image, from the eighth byte of a PNG onward | 8 |
| chunk length (13) and `IHDR` | 8 |
| width (`u32`) / height (`u32`) | 16 / 20 |
| bit depth / colour type | 24 / 25 |

`ReadMetaData` reads eight bytes, checks that they spell `MalieGF`, replaces them with the PNG signature and
hands the rest of the file to the PNG reader. **The replacement is exactly as long as what it replaced**, so the
chunk length, the chunk type and the image header land at the offsets a PNG would have them at — which is why
detection here is the tag plus a well formed `IHDR`. The port reads the dimensions, the bit depth and the colour
type and turns the last two into a pixel depth: one channel for greys and palettes, two for grey with alpha,
three for colour, four for colour with alpha.

## Passing the image through instead of decoding it

`PngFormat.Read` decodes the PNG, which this project has no code for — there is no PNG helper in `shared/` and
the ISM format is deferred for the same reason. The port therefore **restores the signature and copies every
other byte**, exactly as the Gaia hidden JPEG port copies its payload: the same length, the same content, and a
`png` entry with `sizeKnown: true` because eight bytes were replaced by eight. The tests compare the whole
output with a structurally well formed PNG, so a port that dropped or reordered anything would fail.

## Notes

* `AsciiEqual` compares the seven characters of `MalieGF`, so the eighth byte of the tag is **never checked** even
  though the reference's own writer puts a zero there. A test overwrites that byte with `0xFF` and expects the
  file to be accepted; the same test would fail against a port that validated all eight bytes.
* A tag that differs inside the seven characters, a body whose `IHDR` chunk length or type is wrong, a file too
  short to hold the header and zero dimensions are all declined, the last as a documented deviation.
* The entry is named after the source file with a `png` extension and covers the whole stored file. Metadata
  carries the dimensions, the optional pixel depth and the tag; the reference declares no extensions and the port
  matches.
* The reference can write, wrapping a PNG in the same tag, so this format is a candidate for a future encode
  path; only detection, listing and extraction are implemented here.

## A process note

The first version mixed up the two lengths: it kept one seven byte constant for both the comparison and the read
offset, so the extraction started one byte late and the tag it reported was `MalieG`. The test that compares the
whole output with the fixture caught it, and the fix separated them — a seven byte `TAG` for the comparison, an
eight byte `TAG_SIZE` for the file layout. It is the sort of off-by-one that a pass-through format has to get
right precisely because nothing decodes the payload to make the mistake obvious later.
