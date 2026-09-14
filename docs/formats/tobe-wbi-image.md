# TOBE image (WBI)

Reference: `GARbro/Legacy/Tobe/ImageWBI.cs`, class `WbiFormat` (GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/tobe/wbi-image.ts` (`tobeWbiImageDescriptor`, `tobeWbiImageFormat`, id
`tobe-wbi-image`).

An image of the TOBE engine. Thirty two bytes hold the word `WBI-`, the version `V1.00` and a zero, the width and
the height as words, and — at `0x1C` — the **byte runs are written with**. The reference describes every image as
twenty four bits and reads it as bottom up rows, which is what the reference's own `ImageData.CreateFlipped`
means.

## The pixels

Behind the header come pixels of three bytes: blue, green and red. Every pixel is read before anything is asked of
what follows it, and the byte after a pixel decides whether it is written once or several times:

* if that byte is the **run byte** of the header, the byte behind it is how many pixels to write — that pixel
  included — and a count of one is therefore written as a run of one;
* if it is not, nothing but the pixels already read are written, and the next pixel starts at that byte.

Two details of the reference are worth keeping exactly:

**The count is the second byte of a little endian word.** The reference reads the pair with `ReadUInt16` and shifts
it down eight places, so the pair behind a pixel is the run byte and then the count; the count is never the first
byte of the pair.

**A count of nothing is not a run of nothing but a pixel.** The reference reads the pair, steps back over it and
sets a flag: the pixel it had just read is written once more, and the **next** pixel it reads takes the run byte
as its blue and throws away the byte behind it — which is the count of nothing. A file that runs out in the
middle of a pixel stops with an error, because the reference reads its pixels without a check.

A run longer than what is left of the image writes what is left of it and no more, because the reference's loop
asks for the end of the image before each pixel rather than after each run.

The tests cover the word and the version, a version and measurements the reference would refuse, plain pixels
with the rows bottom up, a run whose count is the second byte of its word, a run of nothing whose escape turns
the run byte into a pixel's blue, a run longer than its image, and a file that ends in the middle of a pixel, one
that ends after a run byte and one with no pixels at all.
