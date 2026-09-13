# Studio e.go! ANT bitmap

Reference: `GARbro/ArcFormats/StudioEgo/ImageANT.cs`, class `AntFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/studio-ego/ant-image.ts` (`antImageDescriptor`, `antImageFormat`, id
`studio-ego-ant-image`).

| field | offset |
|---|---|
| signature `ANTI` | 0 |
| width (`u32`) | 0xC |
| height (`u32`) | 0x10 |
| pixels | 0x18 |

The depth is not stored — this format is always four bytes a pixel — and the metadata read validates nothing,
not even the dimensions.

## The pixel stream, and its nominal rows

A pixel is four bytes: a marker byte, then three colour bytes, in that order in the file.

* a **non-zero** marker is an alpha value: the next three bytes are the colour and the marker becomes the alpha
  byte of the pixel, so a pixel reads `alpha, r, g, b` in the file and `r, g, b, alpha` in the bitmap;
* a marker of **zero** is followed by a count: `00 00` ends the current row, and any other count **skips** that
  many pixels, leaving them transparent.

The two loops make the row structure **nominal**. The outer loop runs once a row, and the inner loop fills the
buffer; but the write position is never reset, so the rows are only as real as the `00 00` markers make them. A
file with fewer markers than rows simply carries on filling into the next row — a test checks that four pixels
with one marker for two rows come out complete — and a file that stops early after a marker leaves the *next*
row reading, which throws, so a short file is an error rather than a partly transparent image.

## Two ways past the end, only one of which happens

The reference's two branches fail differently, and the port keeps the asymmetry:

* a **skip** only moves the position, never indexing the buffer, so a skip past the end is harmless — the inner
  loop's condition ends and the image comes out with the skipped pixels transparent, which a test exercises with
  a skip of two hundred in a two pixel image;
* a **literal** writes three colour bytes and then an alpha byte four places along, which the reference indexes
  without a check. The port guards that index, but the guard is **unreachable**: the position only ever advances
  in steps of four and only exits the loop when it reaches the buffer's end, so a literal can never start in the
  final three bytes. The guard is kept because it documents the reference's unchecked store, and the doc says so
  rather than leaving a reader to wonder why no test covers it.

The probe also requires three colour bytes to be present before a literal is taken, so a stream that ends inside
a pixel fails rather than producing a partial one.

## Notes

* The output is a top-down 32 bit bitmap (`ImageData.Create`, so a negative height), and the byte order is
  whatever the file carried: the port copies the colour bytes rather than swapping channels.
* Zero dimensions are accepted, since neither is validated, and produce a header with no pixels; a test checks
  the output is exactly a bitmap header.
* The buffer is allocated zeroed, so anything the stream never writes reads as transparent.
* A header shorter than 0x18 bytes, or one without the signature, is declined. The port does cap the dimensions
  at 256 MiB of pixels, which is a recorded deviation.
* `Write` throws `NotImplementedException` in the reference, so encoding is out of scope.
