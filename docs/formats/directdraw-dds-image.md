# Direct Draw Surface format

Reference: `GARbro/ArcFormats/DirectDraw/ImageDDS.cs`, classes `DdsFormat`, `DdsMetaData` and the walks inside
the format, with the block decoder of `ArcFormats/DirectDraw/DxtDecoder.cs`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/directdraw/dds-image.ts` (`directDrawDdsImageDescriptor`,
`directDrawDdsImageFormat`, id `directdraw-dds-image`, `readDdsLayout`, `readDdsPixels`, `readDdsPicture`),
with the three kinds of block in `packages/formats/src/shared/dxt.ts`.

The file begins with the four letters `DDS ` — the word the reference registers — the head gives its own size
at four and has to stand at a hundred and twenty four bytes or more, the height and the width stand at `0x0C`
and `0x10`, the places of the colour stand at `0x50` and the four letters of a compressed kind at `0x54`, the
depth at `0x58`, and the four masks of the colour at `0x5C`, `0x60`, `0x64` and `0x68`. The pixels stand
behind the head, four bytes and the size the head gave itself behind the beginning of the file — so the port
hands out a picture whose rows stand **top down**, which is what `ImageData.Create` means.

A picture whose colour the head gives the places of is read a byte, a word or a word of four bytes a pixel and
every place of it is spread out to a byte of its own by taking the place over and over up to the whole. A
picture of thirty two bits a pixel whose places are the three of a plain colour stands as it is. Where the
head gives a fourth place the fourth byte of a pixel is spread out from it, and where it does not it stands as
nought. Where the head gives no places at all the reference would spread a colour out by a place of nought,
which its own walk answers with a division by nought; the port turns such a picture away with a message
instead.

A compressed picture stands behind four letters: `DXT5` and `DXT3` take sixteen bytes to every block of four
by four pixels and `DXT1` takes eight. What every block holds is written in `docs/formats/shared-dxt.md` — the
two kinds of colour of five, six and five bits, the two places of interpolation of the first and the third
kind, sixteen places of alpha of four bits for the third and two places of a byte each with three places a
pixel for the fifth. Any other four letters are turned away, as are the colours of the YUV and luminance kinds
the reference names.

Deviations from the reference, in the message only: an impossible depth, a picture cut short of its pixels or
its blocks, and a colour without places are refused, where the reference would throw a `NotImplementedException`,
an `InvalidFormatException` or read outside its own array. For a compressed picture whose sides are not whole
numbers of blocks the reference reads fewer bytes than its own walk needs and would run past its array; the
port asks for as many bytes as the walk reads and turns the picture away where they do not stand.

The tests cover the head, the marks, the size of the head and the sizes it is turned away for, a picture of
thirty two bits a pixel standing as it is, the places of a colour of sixteen and of eight bits spread out, the
first, the third and the fifth kind of block, a compressed kind and a colour it does not read, a picture cut
short of its pixels, and a file that does not hold a picture.
