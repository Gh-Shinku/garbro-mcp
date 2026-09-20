# Crowd engine image format

Reference: `GARbro/ArcFormats/Crowd/ImageCWP.cs`, class `CwpFormat`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/crowd/cwp-image.ts` (`crowdCwpImageDescriptor`, `crowdCwpImageFormat`,
id `crowd-cwp-image`, `readCwpLayout`, `standCwpAsPng`).

## The head

The reference registers the words `CWDP` and, behind them, the words `AMNP`, and the words of the head of a
of the picture, which stands as nothing, as a place of a colour of a palette, or as two, four, or six places of
a colour. The reference stands every picture of its kind as a picture of two and thirty places a place.

## The places of a picture

## Deviations from the reference

- The reference hands the words it stands to the reader of the pictures of the kind it stands as, which reads
  round; this project reads no places of such a picture, so this port hands the words and the places it stands
  out as they stand.
- A picture of no places, of a number of places a place of a colour stands in that stands as none of the five
  numbers the reference reads, and of a kind of places of a colour that stands as none of the five kinds the
  reference reads is turned away; the reference would read such a head as no picture of its kind.

## Tests

`tests/formats/crowd-cwp-image.test.ts` covers the head of a picture and the heads it is turned away for, the
is told by. What the port hands out stands against the reader of the heads of such pictures, which reads the
