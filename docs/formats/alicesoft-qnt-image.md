# AliceSoft System image format

Reference: `GARbro/ArcFormats/AliceSoft/ImageQNT.cs`, classes `QntFormat` and `Reader`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/alicesoft/qnt-image.ts` (`alicesoftQntImageDescriptor`,
`alicesoftQntImageFormat`, id `alicesoft-qnt-image`, `readQntLayout`, `unpackQnt`).

## The head

The reference registers the words `QNT` and stands three kinds of head behind them, the kind standing at the
four places behind the words and above the second kind standing as no kind at all. The words of the first kind
stand at `0x10` and of the other kinds at `0x14`, the latter naming the size of the head as well, and the words
of every kind name where the picture stands, how wide and how tall it stands, how many places a place of it
stands in, how many places the walked places of its colours stand for, and whether it stands with places of a
transparency.

## The places of a picture

The places of the three colours of a picture stand walked beside each other, every place of a colour standing
as the places of two rows of the picture, the place of the row that stands before the other standing first, and
the walked places of the transparency of a picture stand beside them where the head of the picture names one,
read beside each other rather than as the places of two rows. Every walked place then stands beside the places
that stand before the place it stands at: along the row that stands first it stands as the place before it
beside the place it stands at, along every other row as the places above and before it beside it, and the first
place of every row as the place above it beside it.

## Deviations from the reference

- The reference reads a picture of this kind only where the words it registers stand at the head of the file, so
  it reads no such words of its own; this port reads them as it reads the head, and turns a file they do not
  stand at away.
- The reference reads the walked places of a picture for the number of places the places of its colours stand
  for rather than for the number the head names, and reads the walked places of its transparency for the number
  of places in a row of the picture rather than for the number its head names; this port reads them the same
  way.
- A picture whose places of a colour stand outside the file, whose head names no places or stands outside the
  file, and whose walked places stand as no walked places at all is turned away; the reference would throw
  while reading those.
- The places of the picture stand as the places of a bitmap and are handed out as a bitmap of three places a
  place where the picture stands with no transparency and of four where it stands with one, which is what the
  reference hands to the caller that writes its pictures.

## Tests

`tests/formats/alicesoft-qnt-image.test.ts` covers the head of a picture of the first kind and the heads it is
turned away for, the places of pictures of three and of four places of a colour a place, a picture of an odd
number of places in a row and of an odd number of rows, the places two bitmaps are written with, the head of a
picture of a kind behind the first, a picture cut short of the places of its walk, and the words of the
picture. The pictures of the test stand worked out with a walk of the places of the reference's own, so their
places stand under a walk this port did not work out.
