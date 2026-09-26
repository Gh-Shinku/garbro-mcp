# Windows bitmap

Reference: `GARbro/GameRes/ImageBMP.cs`, classes `BmpFormat` and `BmpMetaData` (Windows device independent
bitmap). GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/gameres/bmp-image.ts` (`gameresBmpImageDescriptor`,
`gameresBmpImageFormat`, id `gameres-bmp-image`). This is GARbro's own reader for the format rather than one of
the engines that hide a bitmap behind a header of their own; a port that finds a bitmap inside another file uses
the shared reader in `packages/formats/src/shared/bmp.ts`, which this format shares.

The reference registers no signature of its own, which offers the format every file it is tried on, and a single
byte pair decides: `BM`. The port keeps that shape, with the rest of the header read inside the reader.

| offset | field |
|---|---|
| 0 | `BM` |
| 2 | the length the bitmap claims, which the reference is lenient about |
| 10 | where the pixels begin |
| 14 | the length of the header that follows |
| 18 | the width, a word in the older header and a double word in every other |
| 20 or 22 | the height, likewise, stored negative when the rows are the other way up |
| 22 or 26 | the number of colour planes, which has to be one |
| 24 or 28 | the bits to a pixel |

A bitmap that claims **no** length, or the fourteen bytes of its own file header, is read as far as it goes, and
one that claims more than the file holds is clamped to the file. A header of twelve bytes is the older one: its
measurements are words, it stores **three** bytes to a colour, its rows are always bottom up, and it has no
compression field at all. Every other header has to be at least forty bytes long and fit inside the length the
bitmap claims.

The colours of a palette are stored blue, green, red, with the fourth byte of a full entry reserved, and the
number of them is however many the depth allows unless the header names one.

## What comes out

The picture is written again at the depth it was stored in, so an eight bit bitmap keeps its colour map, a
sixteen bit one keeps its colour masks and a palette bitmap keeps its indices. Two things the reference does are
left out:

* the readers it tries before its own decoder are behind a setting that is off unless a user turns it on; of
  them this port carries the one that matters in practice, `AlpBitmap`, which looks for a companion of the same
  name with the extension `.alp` and lays it over the fourth place of every place of the picture. The companion
  holds as many places of the alpha as a row of the picture holds, of the count a row of a bitmap stands of —
  the count of the places of the picture rounded up to four — or of the count of the places of the picture
  itself; a companion of any other count, and a picture with no companion, stand as they are. The rows of the
  companion stand of the rows of the picture as the file stores them and not as they are read, so a picture
  whose rows stand the other way round in the file takes the rows of its companion the other way round as
  well; the reference walks the stored rows in either case, which is the same thing for such a picture and the
  other way round for one stored the right way up;
* the two **run length** layouts are read here as well, where the reference hands such a picture to the framework
  of its platform: a pair of places of the file whose first stands of a count of places and whose second of a
  colour behind them, a count of nothing standing of one of four marks — nought ends the row of the picture, one
  ends the picture, two moves the walk by two places of the file and any other count stands of that many places
  of the colours themselves behind the pair, of an even count of places of the file. A picture of one place of a
  colour of a place stands of a place of a colour a place and one of half a place of a place of a byte of two of
  them, the first of the two in the high places of that byte. The walk stands of the rows of the picture from its
  foot up, and the places it walks out are stored the way a bitmap of this port stores them.

The third reader in front of the reference's own walk is `BmpDepthFixer`, which the Hyperspace engine stands
for: a picture whose head names **two** places of the file a place while the places behind it stand of **three**,
and of as many places as the file holds and no more, is read as a picture of three places of the file a place.
The head of a picture of two places of the file a place whose row of places stands of as many places as a row of
three would changed the depth of it stands of, such as a picture of twelve places of the file a place, is read
that way; a picture of any other width stands as its head says. This port tries the readers in the order the
reference composes them: `BitmapWithAlpha` first and `BmpDepthFixer` behind it.

The other reader of the framework, `BitmapWithAlpha`, is always in front of the reference's own walk, and this
port carries it as well. It takes two shapes, both of them of a bitmap whose head declares a count of the places
of its file that does not stand of the places of the picture the usual way:

* a bitmap whose head names **three** places of the file a place while the count of the places of its file stands
  of the places of the picture alone carries the alpha of every place **behind** those places, of a place a place
  of the picture, and comes out as a picture of four places of the file a place;
* a bitmap whose head names **four** places of the file a place while the count of the places of its file stands
  of three places a place is read as a picture of four places of the file a place anyway, with the places the
  file does not hold standing at nought.

Both walks read the places of the picture from the place the head names and, of the first shape, the alpha from
the place those places end at, in the order the file stores them, so the places of the picture come out the
right way up. The reference walks both as if the rows of the file stood bottom up, which is what a bitmap of a
height above nought carries; this port takes the height the head declares, so a picture whose rows stand the
right way up in the file comes out the right way up here as well.

The height a bitmap with top-down rows declares is stored negative. The reference reads that word as unsigned and
reports a measurement in the billions; the port reports the height of the picture it hands back, which is the
same measurement with its sign taken off.

The reference can also **write** bitmaps, which this project does not do: it only takes them apart.

The tests cover the tag that finds a bitmap and the buffers that are not one, the measurements a header declares,
every depth the reader can weave including the two the older header stores, the two lengths a bitmap may leave
out and the length that is clamped, a header too short to be one and a bitmap whose pixels are not there at all,
and a depth the reader does not know.
