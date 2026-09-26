# QLIE picture of an alpha and colours (`ARGB`)

Reference: GARbro `ArcFormats/Qlie/ImageARGB.cs` — class `ArgbFormat` — at GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

The picture opens with the mark `ARGBSaveData1` and a kind of three, and then holds two streams side by side:
a JPEG, which carries the colours, and a portable network graphic, which carries one grey place a pixel as
the alpha of the picture.

## Head

| offset | field |
| --- | --- |
| 0 | `ARGBSaveData1` and a zero byte |
| 0x10 | the kind of the picture; the reference reads three and turns any other away |
| 0x11 | the length of the JPEG, four bytes |
| 0x15 | the length of the graphic, four bytes |
| 0x19 | the JPEG, of the length above, and then the graphic |

The box of the picture is the box of the JPEG: the reference reads it from the JPEG's own head through its
JPEG reader, and a head that names a stream that is no JPEG is no head of this format.

## Extraction

The two streams are joined into a picture of four places a pixel: the colours come from the JPEG and the
alpha from the graphic, taken as the brightness of its place. The reference raises when the two name
different boxes, and this port does the same.

Decoded here: the JPEG through `packages/formats/src/shared/jpeg-image.ts`, a reader of the baseline
sequential profile of ITU-T T.81 written for this project, and the graphic through
`packages/formats/src/shared/png-image.ts`. The reference hands the JPEG to the platform decoder of the
Windows imaging stack and the graphic to its decoder of that format.

## Deviations

* The reference reads the graphic as a picture of one grey place a pixel and this port takes its brightness
  as `0.299 * red + 0.587 * green + 0.114 * blue`, rounded. For a graphic that is already grey, which is the
  place the format puts it to, the two agree exactly.
* The reference decodes the JPEG through its platform, whose widening of a twice-as-coarse chroma it folds
  into the colour conversion; this port widens the chroma in the colour space of the stream, so the two
  pictures differ by a few places at the edge of a colour change. The JPEG reader says more about this.
* A head that names a JPEG reaching past the end of the file is turned away as an unknown format here; the
  reference reads the head and fails later, at the extraction.
* `ArgbFormat.Write` raises in the reference and this port creates no archives at all.

## Tests

`tests/formats/qlie-argb-image.test.ts` builds the streams of the format here and pins:

* the head: the box of the picture, the kind of three, and the refusals of another kind, of a length that
  reaches past the end of the file and of a stream that is no JPEG,
* the listing: one entry, `image.bmp`, of the box of the JPEG,
* the join of a grey graphic into the alpha, place by place,
* the join of a colour graphic, taken as its brightness,
* the join of a picture of three components, within two places of the recorded decode of the same JPEG,
* the refusals of a graphic of another box, of a graphic that is no graphic and of a picture whose colours
  stand in no JPEG.

`tests/formats/shared-jpeg-image.test.ts` pins the JPEG reader itself: a baseline stream built here from the
layout of ITU-T T.81, of four flat blocks, exactly; the same stream with a restart marker in its coded data;
a stream whose coefficients stand at the width of a byte; a grey stream recorded from the Python imaging
library, exactly; a stream whose components each sample the picture, to within two places; a stream whose
chroma is sampled twice as coarsely across, to within three; a stream whose chroma is sampled twice as
coarsely both ways, within the wider bound libjpeg's own widening implies; a stream whose chrominance places
sample the picture four times as coarsely as the luma, where the reader repeats the nearest sample rather
than widening with the filter above, against hand-computed places; the refusal of a progressive stream; and
the refusals of a stream that is no stream of the format.

## References

- `GARbro/ArcFormats/Qlie/ImageARGB.cs` — `ArgbFormat.ReadMetaData`, `ArgbFormat.Read`
- `packages/formats/src/qlie/argb-image.ts`
- `packages/formats/src/shared/jpeg-image.ts`, `packages/formats/src/shared/jpeg.ts`
- `packages/formats/src/shared/png-image.ts`
