# Studio Jikkenshitsu image format

Reference: `GARbro/ArcFormats/StudioJikkenshitsu/ImageGRD.cs`, classes `GrdFormat` and `GrdReader`, over
`ArcFormats/StudioJikkenshitsu/SjTransform.cs`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/studio-jikkenshitsu/grd-image.ts`
(`studioJikkenshitsuGrdImageDescriptor`, `studioJikkenshitsuGrdImageFormat`, id
`studio-jikkenshitsu-grd-image`, `readGrdLayout`, `grdKey`, `decodeGrdPixels`, `decodeGrdAlpha`,
kind of `@garbro-mcp/codecs` and the bitmap writers of `packages/formats/src/shared/bmp.ts`.

The reference registers the word `GRD ` and no name at all.

## The head

cipher, the width stands in the words at `0x06` and the height in the words at `0x08`. The word at `0x0C`
those places stands as.

## The cipher

tables of the standard, and stands every block of the stream under it on its own. The key stands as the four
low places of every place of the key the reference names for its own pictures, which is the same expansion the
standard cipher knows.

The key of the reference, `{ 15, 0, 1, 2, 8, 5, 10, 11, 5, 9, 14, 13, 1, 8, 0, 6 }`, holds a place of nought
in its second place, and the reference leaves every place behind such a place out; the key therefore stands as
one place of four and twenty places of nought, which is what this port stands it as.

Behind the head stands a walk of the LZSS kind of the kind the reference's own reader knows. What it stands is
the head of the walk, which the reader reads past, then the colours of a picture of eight bits — four places a
itself. The places of a picture of eight bits stand in rows that hold a whole number of four places of a

under a walk of the LZSS kind of its own, which stands from behind those places to the end of the file and
stands as many places as the head names. The shape begins with two tables: how many places of a row stand
the picture then stands as the colours of the picture first, and a place that stands under a colour of its own

## Deviations from the reference

- A file of fewer than four and twenty bytes, a file that does not hold the word of the format, a picture whose
  places of a colour stand beside any but eight and four and twenty, a picture of no places or of more places
  than this project will hold, and a picture whose walk does not stand whole in the file are turned away; the
- A walk that stands fewer places than the picture holds, and a shape that stands fewer places than the words
  reads them, so a picture whose shape stands behind other places still reads them the same way.
- The places of a picture stand as a bitmap of their own, the picture standing the other way up from the
  been stood in it.

## Tests

`tests/formats/studio-jikkenshitsu-grd-image.test.ts` covers the head and the words it is turned away for, the
key the reference stands its own pictures under, a picture of four and twenty bits whose places stand under the
cipher, a picture of eight bits with its colours, a picture with a shape of its own, the picture a file hands
out, and the finding of a picture of its own kind. The picture that stands under the cipher is built with the
command line of the standard cipher, which stands its walk under a key of the reference's own, so the port
stands places under a cipher that was not worked out with the port's own code.
