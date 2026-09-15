# Force image

Reference: `GARbro/Legacy/Force/ImageDZP.cs`, class `DzpFormat`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/force/dzp-image.ts` (`forceDzpImageDescriptor`, `forceDzpImageFormat`,
id `force-dzp-image`, `readDzpLayout`).

The format is registered under **two words** rather than one — the depth the picture opens with, which is
either eight or twenty four and nothing else — and the reference reads it from the name as well, `.dzp`. The
header holds the depth, the width and the height, and the two latter are kept in **blocks of four pixels**, so
a picture of 1024 blocks across is 4096 pixels across. A picture of no blocks either way, or of more than 4096
of them, is not one this format claims.

The pixels come in two kinds of run, and both leave the rows unpadded, which the bitmap writer behind them
takes care of:

* a picture of **eight bits** keeps a colour map of 256 colours first — four bytes to a colour, blue, green,
  red and a byte of nothing — and then a byte and the count of times it is written;
* a picture of **twenty four bits** holds three bytes to a pixel and, behind them, the count of times the
  pixel is repeated, counted **from the pixel just read**, so the copy runs over itself. A count of nothing
  does not move where the picture is being written: such a pixel lands on the one the op before it wrote, and
  the last write is the one that stands.

A stream that stops early leaves the rest of the picture as it was, which is where the zeroes of a short
stream come from; a run that reaches past the picture is refused with `INVALID_ARCHIVE`, where the reference's
own copy would throw, as is a picture of eight bits with no room for its colour map. A picture whose pixels
would need more than 256 MB is refused with `LIMIT_EXCEEDED`.

Nothing here writes the format: `DzpFormat.Write` is not implemented in the reference either.

The tests cover finding a picture of the format's own name and depth and declining any other, a picture of
more blocks than the reference reads, the width and the height counted in blocks, a picture of twenty four
bits whose pixel repeats, the count of nothing landing on the pixel before it, a picture of eight bits with
its colour map, the zeroes a stream that stops early leaves behind, a run reaching outside the picture in
either depth, and a picture with no room for its colour map.
