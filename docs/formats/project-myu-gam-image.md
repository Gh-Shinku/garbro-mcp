# Project-μ compressed bitmap

Reference: `GARbro/Legacy/ProjectMyu/ImageGAM.cs`, classes `GamFormat` and `GamDecompressor`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/project-myu/gam-image.ts` (`projectMyuGamImageDescriptor`,
`projectMyuGamImageFormat`, id `project-myu-gam-image`, `readGamLayout`, `unpackGam`).

The file begins with the four byte word `GAM\0` — the reference compares the whole word, so the byte behind the
three letters is part of it — and the stream of the picture begins at offset eight, the four bytes between
being inert.

The stream is a row of **two byte control words**, each governing **sixteen** ops, least significant bit first,
and behind every word the bytes its ops take: a bit of **nothing** is a byte of the picture, which takes one
byte of the stream and goes into a `0x100` byte window as well; a bit of **ones** is a run, which takes two
bytes — a place and a count — and copies the count of bytes from the place back in the window, **one at a
time**, so a run that overlaps where it writes repeats what it has just written. The window is round, and so a
place of `0x100` reaches back exactly one window and lands on the slot it is about to write. A control word is
delivered by two bytes of the stream, and the reference keeps a bit above them to know when they are spent;
where the two bytes of a word cannot be read, or the byte of a literal cannot, the stream ends.

The stream carries no length of its own: the reference unfolds it on demand, for as long as whoever reads it
asks and the input lasts, so `unpackGam` unfolds up to the length asked and stops there or where the input
ends. The picture is a **bitmap** in full: `ReadMetaData` reads eighteen bytes of the unfolded stream to see
how long the header of that bitmap claims to be, and the pixels, the colour map and the colour masks are read
straight out of the stream as well, so the length the port unfolds to read a picture is the length the bitmap
it declares needs. `openEntry` refuses a declared picture above `0x10000000` bytes with `LIMIT_EXCEEDED`,
where the reference would try to read it and fail when the input ends; a stream cut short of the bitmap is
refused with `INVALID_ARCHIVE`, and nothing here writes the format.

Deviations, both for streams the reference would only fail on later:

* the port wants the **whole header** the bitmap declares to be present, because the shared bitmap reader
  takes the header in one piece, while the reference reads only the eighteen bytes its own reader looks at —
  a stream of, say, twenty bytes that declares a forty byte header is claimed by GARbro's metadata and must
  then fail to read, and is declined here;
* a picture whose declared length is above the bound is refused with `LIMIT_EXCEEDED` rather than read until
  the input ends.

The tests cover finding a bitmap behind the words of the format, declining a stream that does not unfold to
one, what the bitmap it unfolds to says about itself, a picture carried a byte at a time, one carrying a colour
map of its own, a run that overlaps itself, a run reaching back a whole window onto the slot it writes, a run
over the zeroes of an empty window, a stream that ends before the picture is whole, a bitmap whose header is
longer than the common one, and the colour of an indexed bitmap.
