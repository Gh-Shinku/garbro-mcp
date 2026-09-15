# U-Me Soft image format

Reference: `GARbro/ArcFormats/UMeSoft/ImageGRX.cs`, classes `GrxFormat`, `GrxMetaData` and `Reader`. GARbro
commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/umesoft/grx-image.ts` (`umesoftGrxImageDescriptor`,
`umesoftGrxImageFormat`, id `umesoft-grx-image`, `readGrxLayout`, `readGrxInfo`, `unpackGrx`). The multi-frame
formats of the same engine wrap this reader around a picture of their own and are ported separately.

The signature word the reference declares is `0x1A585247`, the four bytes `GRX\x1A`, and it declares no
extensions. The header is sixteen bytes:

| offset | what it holds |
| --- | --- |
| `0x04` | whether the pixels are walked as runs or stand in the stream as they are |
| `0x05` | whether the picture carries a plane of alpha behind the pixels |
| `0x06` | the depth |
| `0x08` | the width |
| `0x0A` | the height |
| `0x0C` | how far behind the pixels that plane stands |

The depths the reader knows are eight, fifteen, sixteen, twenty four and thirty two bits; any other depth, and
a picture of no width or height, is turned away where the reference would throw. A pixel takes as many bytes in
the stream as its depth needs rounded up to a whole one, and is written out with four bytes when the depth is
twenty four or thirty two and with as many as it came in with otherwise — so the depth the port reports is the
one it writes out, which is four bytes for a picture of three.

A picture that does not stand behind the walk is read as the pixels that stand in the stream, as many bytes as
the reader's own buffer holds, which is the width of the picture rounded up to a whole four bytes for every row
of it; a stream that does not hold them all leaves the rest at nothing. A picture behind the walk is read with
one walk for every row:

| flags | what the run is |
| --- | --- |
| none of the four highest, without the bit worth eight | a run repeating the pixel the stream brings |
| none of the four highest, with the bit worth eight | a run of pixels that stand in the stream themselves |
| the four highest, without the bit worth eight | a run copied from a place behind, a pixel at a time |
| the four highest, with the bit worth eight | the same, a whole run at once |

The lowest two bits of the control byte hold the count less one and the bit worth four says a byte behind it
holds the rest of it, so a count of one to four takes one byte and anything longer takes two. The four highest
bits choose the place a copy comes from out of two tables, one counting rows of the picture and one counting
pixels of them, so a place of nothing is the pixel the run stands in, one of the second kind is the pixel above,
and one of the ninth is four rows above. A copy a pixel at a time takes the place it was given for every pixel
of the run, so it writes the same pixel over and over rather than walking along, which is what the reference
does; a copy a whole run at once walks along behind the picture as it goes. A place that reaches before the
start of the picture, a copy that reaches past its end and a stream that runs out inside it are all refused,
where the reference's own reader would throw.

A picture with a plane of alpha unpacks it the same way from where the header says it stands, one byte to a
pixel. A picture of three or four bytes to the pixel takes that plane as the fourth byte of every pixel, which
makes it a picture of four; a picture of two bytes takes the plane with it as well, widening every pixel to four
and stretching its three colours over the whole of a byte; the plane of any other depth is unpacked and then
left behind, which is what the reference does as well.

The reference hands its rows to the bitmap reader with the length the walk counts, which for a picture of one
byte to the pixel is the width rounded up to a whole four bytes and for a wider pixel is the same count taken
again, so the two lengths differ for a picture of more than one byte to the pixel whose width is not a whole
four. The port writes the picture out tightly either way, which is a deviation in that case only, and the
length of the reader's buffer is always the larger one, as the reference has it.

The tests cover the four bytes of the signature, the declines of a depth the reader does not know, of a picture
of no width or height and of a header that is not all there, the depth reported for a picture of three bytes
and the depth a picture of two keeps, the pixels of a picture that stands in the file as they are, a row of
runs that stand in the stream with the row behind it copied from above, a run that repeats the pixel the stream
brings and one copied a pixel at a time, the rows of a picture whose width is not a whole four, the plane of
alpha taken as the fourth byte of a picture of three and the stretching of a picture of two that carries one,
the refusals of a run that copies from before the start of the picture and of a stream that runs out inside it,
a picture too large to hold, and the runs of a picture of one pixel read on their own.
