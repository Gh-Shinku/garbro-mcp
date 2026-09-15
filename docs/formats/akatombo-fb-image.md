# Akatombo image format

Reference: `GARbro/Legacy/Akatombo/ImageFB.cs`, classes `FbFormat` and `FbReader`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/akatombo/fb-image.ts` (`akatomboFbImageDescriptor`,
`akatomboFbImageFormat`, id `akatombo-fb-image`, `readFbLayout`, `unpackFb`).

The header is eight bytes: the two letters `FB`, then a byte the reference reports as the depth but never uses
— the pixels are always four bytes to the pixel — then the width and the height, both two bytes. The
signature word the reference declares is `0x184246`, the two letters followed by `0x18`.

The stream behind the header is read bit by bit, a word of four bytes at a time, highest bit first and big
endian. The reader of the reference starts on a word that is not there, so the first bit it hands out is the
highest bit of the first word of the stream, and it marks the bottom bit of every word it reads to know when
the word runs out: thirty two bits come out of a word before the next one is read. A word the stream only
partly holds keeps whatever the word before it left in the bytes it does not fill, which the reference's own
reader does as well; a stream with no bytes left where a word is wanted is refused. The write path of the
reference throws `NotImplementedException`, so this is a read only format.

Every pixel is four bytes, of which the last is never written: it holds whatever a copy brought there, and
nothing at all for a pixel built from the stream. A pixel starts with a bit that says how it is made:

* the bit stands at one — the pixel is built from nothing, and the three differences behind it are its colour;
* the bit stands at nothing — two more bits choose one of the four pixels around it to copy, and a copy whose
  place stands before the start of the picture is left alone, which is how the first pixel of the picture and
  of every row are built from nothing. The two bits are read as a row above or not, and then as a place along
  that row or not, but the place is counted in the stream of pixels rather than across the picture, so the
  pixel a row up and one along from the last pixel of a row is the first pixel of the row it stands in.

Behind the copy, if there was one, come three differences — blue, green and red — which are added to the three
bytes the copy brought, as bytes, so they wrap around. A difference is written as a count of the bits that
stand at one before the value, then that many bits: the last of them says whether the difference stands below
nothing, and the rest say how far from nothing it stands, so a count of one bit is nothing, two bits are one or
minus one, three are two or minus two, and so on.

The rows of the picture are stored the other way up, which is what the flipped picture of the reference means,
so the bitmap is written with a height above nothing and its rows as they stand. The port reports the depth it
writes, thirty two bits, rather than the byte the header declares. A picture of no width or height, a stream
that runs out inside the picture, and a picture whose pixels would take more than 256 megabytes are refused.

The tests cover the two letters and the four byte signature, the declines of a picture of no width or height
and of one that is too short to hold a header, the measurements and the reported depth, the flipped rows, a
pixel built from its own differences, a copy from the pixel to the left with its differences added and with
one of them below nothing, the four places a copy can be taken from with the wrap of the place counted in the
stream, a copy at the very first pixel where every place stands before the picture, a picture whose bits run
past one word, the refusals of a picture with no stream behind it and of one that asks for more bits than its
stream holds, and a picture too large to hold.
