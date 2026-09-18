# AZ system image format

Reference: `GARbro/ArcFormats/AZSys/ImageTYP1.cs`, classes `Typ1Format`, `Typ1MetaData` and the `Reader` inside
the format. GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/azsys/typ1-image.ts` (`azSysTyp1ImageDescriptor`,
`azSysTyp1ImageFormat`, id `az-sys-typ1-image`, `readTyp1Layout`, `readTyp1Palette`, `unpackTyp1`).

The file begins with the word `TYP1` — the word the reference registers — the depth of a pixel stands at four
and a byte at five that names a colour map, the width and the height stand at six and eight as words, and a
word of four bytes at `0x0A` says what the one stream of a picture holds.

Where that word, the size of the colour map a picture of eight bits would carry and the fourteen bytes of the
head come to the size of the file, the pixels stand in **one stream** behind the head — and behind the colour
map where the picture is one of eight bits, since such a picture always carries one in that shape. Where they
do not come to the size of the file, the pixels stand in **four streams of their own** and the head gives the
size of every one of them at `0x0E`, four bytes apart.

The walk of the four streams is the reference's own: the fourth stream of the head stands first in the file,
then the third, the second and the first, every one of them standing four bytes of its own checksum behind
where the one before it ends. What each stream writes is the byte of a pixel the reference's own map gives —
the fourth stream the fourth byte, the first the first, the second the second and the third the third — one
byte a pixel at a time. An eight bit picture whose pixels stand in four streams ignores them and reads its
whole picture from the one stream that stands behind its colour map and its checksum.

What is handed out is a picture of a byte a pixel where the depth is eight — with the colour map of the
picture, or with the map of greys where it carries none — and of four bytes a pixel where the depth is twenty
four or thirty two, since the reference hands both of them to its caller as four byte pixels. A picture whose
pixels stand in one stream has that stream read for as many bytes as it gives, so a stream that gives less
than the picture asks for leaves the rest of it standing as nought, which is what the reference's own read of
a stream does. The picture stands **top down**, which is what `ImageData.Create` means.

Deviations from the reference, in the message only: a depth other than eight, twenty four or thirty two bits
and a picture cut short of its streams are refused, where the reference would throw an `InvalidFormatException`
or read outside its own array. A picture whose pixels stand in one stream is taken at the size of the file
rather than at a length the stream itself would give, which is what the reference's own size check reads.

The tests cover both shapes of head, the marks and sizes it is turned away for, a picture of thirty two bits a
pixel from one stream, an eight bit picture with a colour map from one stream, an eight bit picture whose
colour map stands behind its own stream, an eight bit picture without a colour map handed out as greys, a
picture of a colour read from three and from four streams of its own, a depth it does not read, and a file
that does not hold a picture.
