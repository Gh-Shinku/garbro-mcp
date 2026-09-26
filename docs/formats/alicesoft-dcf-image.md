# AliceSoft System incremental picture (`DCF`, `PCF`)

Reference: GARbro `ArcFormats/AliceSoft/ImageDCF.cs` — classes `DcfFormat`, `DcfMetaData`, `DcfReader` — over
the picture of the same engine in `ArcFormats/AliceSoft/ImageQNT.cs`, at GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

An incremental picture of the engine stores a head, then a chain of chunks, then one picture of a QNT stream
whose pixels are the whole picture (`dcf `) or are laid over a picture named by the head (`pcf `).

## Head

| offset | field |
| --- | --- |
| 0 | `dcf ` or `pcf ` |
| 4 | header size, measured from offset 8 |
| 8 | version, `1` only |
| 0xc | width |
| 0x10 | height |
| 0x14 | depth: 24 or 32 |
| 0x18 | length of the name that follows, at 0x1c |

The name bytes are read as stored and then each byte is rotated left by `(length % 7) + 1` bits; the result is
the file name of the picture the overlay is laid over (`pcf`) or the picture whose masked blocks are kept
(`dcf`). The chunks start at the header size plus eight bytes.

## Chunks

Every chunk is a four byte identifier, a four byte body length, and the body. The walk reads chunks in order
until it reaches the picture:

| identifier | meaning |
| --- | --- |
| `dfdl` | a block mask: a four byte unpacked length and a zlib stream, whose bytes are read as 16×16 blocks of the picture, starting four bytes into the buffer |
| `ptdl` | two words, the x and y offset of the overlay for a `pcf` picture |
| `dcgd`, `pcgd` | the end of the chain; the QNT stream starts with the body |

## The picture

The QNT stream is decoded with the ported QNT reader (`packages/formats/src/alicesoft/qnt-image.ts`) and the
result is one of:

* a `dcf` picture with no base picture: the decoded overlay as it stands,
* a `dcf` picture whose mask named a base picture: the overlay with every masked 16×16 block replaced by the
  same block of the base, which is read beside the picture as `<base name>.qnt`, or as `<base name>.pcf`
  decoded by this same reader when no QNT of that name exists (the file itself is never its own base),
* a `pcf` picture: the base picture with the overlay blended onto it at the offset the `ptdl` chunk names.
  A `pcf` picture with no base blends onto a fully transparent base of the head's size and depth.

The blend follows the reference: a fully opaque overlay pixel, or one over a transparent base pixel, is
copied, and any other pixel is mixed with `(overlay * alpha + base * (255 - alpha)) / 255` and takes the
larger of the two alpha values. The reference treats the base as four bytes a pixel in this walk, which the
port keeps.

## Deviations

* The base picture lookup is a companion file, like the reference's `VFS` lookup, and it is bounded: this
  port refuses to follow more than four base pictures, so a chain that names itself through other files ends
  instead of running forever.
* The head is validated more strictly than the reference: the width and height have to be non-zero, the name
  has to be present and to fit, and the chunk walk refuses a chunk whose length does not move it forward.

## Tests

`tests/formats/alicesoft-dcf-image.test.ts` builds pictures in the test:

* the head and the rotated base name,
* a `dcf` picture that stands alone, whose pixels equal the QNT decode of the same stream,
* a `dcf` picture with a `dfdl` mask and a `<base name>.qnt` companion, whose pixels are the base's,
* a `pcf` picture with a `ptdl` offset of (4, 4) over a transparent base, whose pixels are the overlay's in
  that rectangle and zero outside it,
* the detection negatives: another word and a head too short to hold one.

## References

- `GARbro/ArcFormats/AliceSoft/ImageDCF.cs` — `DcfFormat.ReadMetaData`, `DcfReader.Unpack`,
  `DcfReader.MaskOverlay`, `DcfReader.BlendOverlay`, `DcfReader.ReadBaseImage`
- `GARbro/ArcFormats/AliceSoft/ImageQNT.cs` — the picture the overlay stands of
