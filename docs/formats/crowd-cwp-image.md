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
of such pictures rather than reading the places of the picture itself. This port stands the same words and
reads them with its own reader of the PNG interchange format, so a picture of this kind is handed out as a
bitmap named `.bmp`, with four bytes a place.

The stream the reference stands carries the check word of its head of the file, the count of the places of its
own places and the check word of those places all as they stand in the file; this port's reader walks them, so
a file whose head of the file and places of the file do not agree with their own check words is refused with
`INVALID_ARCHIVE`.

## Deviations from the reference

- The reference hands the words it stands to the reader of the pictures of the kind it stands as, which reads
  the places of the picture and then stands the first and the third byte of every place of it the other way
  round while calling the result a picture whose places stand blue, green, red then alpha. Nothing in the
  engine asks for that swap, which is a device of the rendering stack the reference decodes through, and the
  places of the picture would come out with red and blue the wrong way round if it were followed: this port
  reads the picture with its own reader of the PNG interchange format and hands the places out as that reader
  gives them, blue, green, red then alpha.
- The reference stands the chunk that ends the stream it builds with three bytes of a count of the places
  where four belong, which leaves the stream one byte short of a chunk. The decoder of the platform stops at
  the places of the picture before it reads that far, so the reference works; this port stands the four bytes
  where they belong, since the reader of this project walks the stream to its end.
- The reference reads the words of the head of a picture of this kind without reading how far the places of its
  head reach; this port turns a picture whose places stand short of the places of its own head away.
- A picture of no places, of a number of places a place of a colour stands in that stands as none of the five
  numbers the reference reads, and of a kind of places of a colour that stands as none of the five kinds the
  reference reads is turned away; the reference would read such a head as no picture of its kind.

## Tests

`tests/formats/crowd-cwp-image.test.ts` covers the head of a picture and the heads it is turned away for, the
words of a portable network graphic stood around the places of a picture, the places that stream carries, the
picture read out of it — the size, the places and the order of the bytes of every place — a picture of the
second kind, a picture cut short of the places of its head, and the words the picture is told by. The fixture
stands a stream whose head of the file and places of the file carry their own check words, which is what the
reader of this project walks.
