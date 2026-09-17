# Vitamin image format

Reference: `GARbro/ArcFormats/Vitamin/ImageSBI.cs`, classes `SbiFormat`, `SbiMetaData` and `SbiReader`. GARbro
commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/vitamin/sbi-image.ts` (`vitaminSbiImageDescriptor`,
`vitaminSbiImageFormat`, id `vitamin-sbi-image`, `readSbiLayout`, `sbiStride`, `unpackSbi`).

The file begins with the word `SBI` and a line feed. The two bytes at four must be a one and nothing, the
depth at six must be at least eight, and the measurements stand at seven and nine as words. The size of the
packed input stands at eleven, the byte at fifteen says whether an eight bit picture carries a colour map, and
the byte at sixteen whether the pixels are packed at all. The depth decides the layout: eight bits indexed
with a colour map of three byte entries of red, green and blue, or **without** one as a ramp of greys,
sixteen bits `Bgr565`, twenty four `Bgr24` and thirty two `Bgr32`. A depth that is not one of those four is
refused; the reference's own reader throws when it meets one, so the port does not offer such a file as this
format either.

A row of the picture is rounded up to four bytes, and the pixels stand **bottom up**: the first row of the
stream becomes the last row of the picture, which is how a bitmap of its own stores them. An unpacked picture
is a run of whole rows. A packed one is a walk of runs of whole pixels:

* a control byte below `0x80` holds that many pixels that stand in the stream themselves, one byte each;
* a control byte at `0x80` or above holds that many less `0x80` pixels, of which the first stands in the
  stream and the rest repeat it.

Every run is placed across the rows of the picture, wrapping onto the row above when the current one is
filled, which is what lets a run cross the edge of a row. A run of no pixels still reads the pixel before it,
as the reference does, and then places nothing. A stream that stops inside a run, and a run that reaches past
the picture, are both refused; the reference's own reads and writes answer both with exceptions (documented
deviations in the message only).

The reference hands the picture out through `ImageData.Create` with the buffer it built, whose rows are
padded; this port takes the padding out of every row before writing the bitmap, since a bitmap writer takes a
row of exactly the width and pads it itself. The write path of the reference throws
`NotImplementedException`, so this is a read only format.

The tests cover the head the reference reads and the four byte row, the two marker bytes and the two depth
refusals, the measurements the port reports, an unpacked picture standing bottom up, a packed picture walked
across whole rows and across the edge of a row, the run that repeats the first pixel of its own, the colour
map of an eight bit picture turned into the order a bitmap wants, and a stream that is cut short.
