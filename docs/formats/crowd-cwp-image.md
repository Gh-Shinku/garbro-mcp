# Crowd engine image format

Reference: `GARbro/ArcFormats/Crowd/ImageCWP.cs`, class `CwpFormat`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/crowd/cwp-image.ts` (`crowdCwpImageDescriptor`, `crowdCwpImageFormat`,
id `crowd-cwp-image`, `readCwpLayout`, `standCwpAsPng`).

## The head

The reference registers the words `CWDP` and, behind them, the words `AMNP`, and the words of the head of a
picture of this kind name how wide and how tall it stands, read the long way round, how many places a place of
a colour of it stands in — one, two, four, eight, or sixteen of them — and the kind of the places of a colour
of the picture, which stands as nothing, as a place of a colour of a palette, or as two, four, or six places of
a colour. The reference stands every picture of its kind as a picture of two and thirty places a place.

## The places of a picture

The places of a picture of this kind stand as the places of a portable network graphic: the reference stands
the words of such a graphic — its own words, the words and the places of the head of the file, the words of its
own places, the places of the file, and the words of the end of such a graphic — and hands them to the reader
of such pictures rather than reading the places of the picture itself.

## Deviations from the reference

- The reference hands the words it stands to the reader of the pictures of the kind it stands as, which reads
  the places of the picture and stands the places of the red and the blue of every place of it the other way
  round; this project reads no places of such a picture, so this port hands the words and the places it stands
  out as they stand.
- The reference reads the words of the head of a picture of this kind without reading how far the places of its
  head reach; this port turns a picture whose places stand short of the places of its own head away.
- A picture of no places, of a number of places a place of a colour stands in that stands as none of the five
  numbers the reference reads, and of a kind of places of a colour that stands as none of the five kinds the
  reference reads is turned away; the reference would read such a head as no picture of its kind.

## Tests

`tests/formats/crowd-cwp-image.test.ts` covers the head of a picture and the heads it is turned away for, the
words of a portable network graphic stood around the places of a picture, the picture handed out as those
words, a picture of the second kind, a picture cut short of the places of its head, and the words the picture
is told by. What the port hands out stands against the reader of the heads of such pictures, which reads the
places of the head of the picture the words were stood around.
