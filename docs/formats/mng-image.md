# MNG image

Reference: `ArcFormats/ImageMNG.cs`, class `MngFormat` (tag `MNG`) - the picture half of a file whose
archive half, `MngOpener`, is already ported beside this one. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`. Implemented as `mng-image`
(`packages/formats/src/mng/mng-image.ts`).

## What the file holds

A `Multiple-image Network Graphics` file: the word `\x8aMNG` and the four bytes a PNG carries behind its own
word, followed by chunks. The first chunk has to be `MHDR`, the canvas the pictures are drawn on, and its
first eight bytes are the width and the height, each written with its higher byte first.

Behind it the file holds one or more pictures, each a run of chunks that begins with `IHDR` and ends with
`IEND`, and the file itself ends with `MEND`. The engine opens the picture at the first `IHDR` it finds: the
chunks between the canvas and that chunk are stepped over, everything from that chunk on is the picture, and
a file that reaches its end before any picture begins is refused.

## How the picture is read

The picture is a PNG: the reference wraps the bytes from that first `IHDR` in the marker a PNG carries and
hands the whole thing to the decoder beside it. This project hands that PNG over as it stands, as it does
for the other formats that hold a picture of another kind inside them, so nothing is decoded here.

## Deviations from the reference

* The reference hands over everything from the first `IHDR` **all the way to the end of the file**, which
  carries the chunks that end the file as well; this port cuts at the end of the first `IEND`, which is where
  the archive half beside it cuts its frames and where a decoder stops. A decoder sees the same picture
  either way.
* The walk of the chunks has no bound of its own in the reference; here it is bounded, a chunk whose length
  is not to be trusted is refused, and so is a chunk that does not advance.
* A canvas chunk has to carry the eight bytes the size is read from, which the reference reads without
  checking, and a canvas of no width or no height is refused.

## Verification

Six tests build files with a mirror writer: a canvas with its size, and the first picture found at the place
the reference counts it to; the picture handed over as a PNG whose own header a decoder reads back - the
frame's size and depth, which the engine leaves to the decoder - and which the format's own extract returns
byte for byte; a file with other chunks between the canvas and the pictures; a file with two pictures, where
the first is taken and nothing of the second is carried; a file that stops behind its pictures; and the
refusals - the four bytes a PNG carries behind its word, a first chunk that is not the canvas, a canvas too
short to name a size, no width, no picture before the file ends, a chunk whose length is not to be trusted,
and a file that stops inside a chunk header.

What stands on the reference alone: the cut at the first `IEND` rather than at the end of the file, which no
fixture here compares against the reference's own range; and no real file is on hand to compare against
GARbro's output.
