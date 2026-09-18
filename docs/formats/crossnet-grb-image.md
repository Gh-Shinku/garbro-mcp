# CrossNet image format

Reference: `GARbro/Legacy/CrossNet/ImageGRB.cs`, classes `GrbFormat`, `GrbMetaData` and `GrbReader`. GARbro
commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/crossnet/grb-image.ts` (`crossNetGrbImageDescriptor`,
`crossNetGrbImageFormat`, id `crossnet-grb-image`, `readGrbLayout`, `unpackGrb`).

The reference registers the two words `8` and `1`, and the first word of the file is the depth, so only one
or eight bits a pixel is read. The width and the height stand at four and six and must lie between one and
`0x8000`, and the offsets of the control bytes and of the literal pixels stand at eight and sixteen, both
behind the head and inside the file. The width is then rounded up — to thirty two pixels at one bit and to
four pixels at eight — and the reader walks a row of the rounded width, or of its eighth at one bit.

Behind the head stands a colour map of two or of two hundred and fifty six entries, then one byte a row, then
the control bytes where the head says and the literal pixels where it says. Every control byte carries **four
pixels of two bits each**, read from the highest pair down:

* a pair of nothing is a literal byte from the stream;
* every other pair names one of four places, told apart by its own value and by the row's own code: for the
  first code a left, a higher row and the two together; for the second a run of lefts up to three; for the
  third a run of rows up to three; for the fourth the row above with its left and its right.

A pair that reaches before the start of the picture is refused, which the reference's own array read answers
with an exception (a documented deviation in the message only). The reader writes four bytes into every
control byte's place, so at one bit a pixel it fills the whole rounded row with a byte a pixel; the port keeps
that behaviour and then takes the padding of every row out before writing the bitmap, which a bitmap's own row
holds neither.

The picture is handed out with its rows **bottom up**, which is what `ImageData.CreateFlipped` means. The
write path of the reference throws `NotImplementedException`, so this is a read only format.

The tests cover the head of each depth and the rounded width, the depth and the measurements and the offsets
the reader turns away, the pixels that stand in the stream, a pixel taken again from the place the row code
names, a reference that reaches before the start of the picture, and the one and eight bit pictures written
out with their colour maps.
