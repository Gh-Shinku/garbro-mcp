# CRI Middleware image format

Reference: `GARbro/ArcFormats/Cri/ImageGXT.cs`, classes `GxtFormat`, `GxtMetaData` and the walk inside the
format, with the block decoder of `ArcFormats/DirectDraw/DxtDecoder.cs`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/cri/gxt-image.ts` (`criGxtImageDescriptor`, `criGxtImageFormat`, id
`cri-gxt-image`, `readGxtLayout`, `bitScanReverse`, `swizzledCoords`, `unpackGxt`), with the fifth kind of
block in `packages/formats/src/shared/dxt.ts`.

The file begins with the word `GXT` — the word the reference registers — and the word `0x10000003` at four,
the width and the height stand at `0x38` and `0x3A` as words of two bytes, the place of the picture at `0x20`
and its size at `0x24`, the place of a colour map at `0x28`, the flags at `0x2C`, and the kind of turning and
the kind of picture at `0x30` and `0x34`. Only the picture of the kind `0x87000000` — the fifth kind of block
— is read; every other kind is turned away with the number the head gives.

What the reference reads next is the whole picture in one piece, but every block of four by four pixels of it
does not stand where the block of the picture itself stands. The two places of a block — the row of blocks
times how many blocks stand in a row, and then the place in that row — are read as a number and that number is
turned around:

* the places above the two lowest pairs of the number stand as they are;
* the two lowest pairs are woven together: the lowest pair of one of the two turned numbers — the even places
  of the number gathered together, which is the place of the block along its row — and that of the other
  behind it;
* where the picture is taller than it is wide the two numbers swap places, and where it is not the turned
  number is read as a row of blocks and a place within it the other way round.

A picture with no blocks at all in a direction is taken to hold sixteen of them, which is what the reference
reaches for when its own division gives nought. The picture the port hands out stands **top down**, which is
what `ImageData.Create` means. The write path of the reference throws `NotImplementedException`, so this is a
read only format.

Deviations from the reference, in the message only: a picture of another kind, a picture cut short of its
blocks and a place that does not stand inside the file are refused, where the reference would throw a
`NotSupportedException` or read outside its own array. Where the head gives a size longer than the blocks of
the picture need, the reference reads all of it and the port keeps that.

The tests cover the head, the marks and the places it is turned away for, the place of the highest bit of a
number, the turning of the two places of a block both for a picture taller than it is wide and for one wider
than it is tall, a picture of four blocks read in the order the turning gives, a picture of another kind, a
picture cut short of its blocks, and a file that does not hold a picture.
