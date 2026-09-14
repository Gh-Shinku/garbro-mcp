# Candy Soft RLE bitmap

Reference: `GARbro/ArcFormats/Interheart/ImageBMP.cs`, class `BmpRleFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/interheart/bmp-rle-image.ts` (`interheartBmpRleImageDescriptor`,
`interheartBmpRleImageFormat`, id `interheart-bmp-rle-image`).

A **bitmap the file already carries a header for**, with the pixel runs behind it:

| field | offset |
|---|---|
| `BMP24RLE` | 0 |
| a whole bitmap header | 8 |
| the runs | behind the header |

The fields the format reads are a **shifted view of the bitmap header** that follows the marker: the size at
`0x0A` is that header's own file size, the header size at `0x12` is its pixel offset, and the width, height and
depth at `0x1A`, `0x1E` and `0x24` are the ones at their usual places. The reference registers the word
`0x32504D42` — `BMP2` — and then compares eight characters, so the eight and sixteen bit flavours, which a
comment in the reference hopes share the algorithm, cannot be reached at all: they do not begin with a
registered word.

The runs are pixels of three bytes, and the decoder **writes each one back reversed** — it names the bytes red,
green and blue in the order they are stored and emits blue, green and red, which is the order a bitmap wants.
Two identical pixels in a row start a run: one more copy of that pixel is written, then a word counts the copies
that follow it. The bitmap that comes out is a **whole bitmap file**, because the header the file carried is
copied to the front of the buffer and the runs fill what follows it; what the entry hands back is the bitmap
itself.

Details worth recording:

* the reference writes a run's count without any look at the buffer, so a run longer than the bitmap fails with
  an index error there; the port reports the same case as a `GarbroError`;
* a stream that stops short leaves the pixels it did not reach as they were allocated, and the reference's own
  reused triple buffer keeps whatever its last read left in it; the port fills what a short read did not reach
  with zeroes;
* a header size larger than the bitmap size fails, as the copy it describes cannot fit.

The tests cover the marker with the two flavours that share neither its word, the size and header checks, the
measurements, the copied header with an expanded run, a run of no further copies, a stream that stops short, the
run that overflows, and the entry name.
