# Propeller image

Reference: `GARbro/ArcFormats/Propeller/ImageMGR.cs`, classes `MgrFormat` and `MgrMetaData`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/propeller/mgr-image.ts` (`propellerMgrImageDescriptor`,
`propellerMgrImageFormat`, id `propeller-mgr-image`, `readMgrImageLayout`), which shares the frame
decompressor of `mgr.ts`.

The reference registers this format under no word at all, so every file is offered to it. A file opens with
how many pictures it holds — one to 255 — and, when it holds more than one, a table of their offsets whose
first entry has to point just past the table itself; a single picture simply follows the count. Behind them
sit the length the picture unfolds to and the length of the stream, which has to lie inside the file.

The picture itself is a **bitmap** in full, header and all, and the reference reads its header off the first
fifty four bytes the stream unfolds to — so a stream that does not unfold to a bitmap header is not one this
format claims, and one that unfolds to fewer bytes than that is refused rather than padded. A picture whose
stream does not unfold to the whole of what it declares is refused with `INVALID_ARCHIVE`, which is why the
shared decompressor grew a mode that refuses a short stream; the archive opener that uses it keeps reading
such a stream with the rest left zeroed.

A picture of any depth but thirty two is written as the bitmap its stream unfolded to. A picture of **thirty
two bits** is a special case in the reference: the rows of the stream are the other way up, and it copies them
out of the unfolded picture backwards, taking the offset of the pixels from the bitmap header, so the first
row of the picture written here is the last row of the stream. That turn is kept, and the alpha of the stream
is kept with it.

The tests cover finding a file of one picture and of several, declining one holding no picture or more than
the reference reads, declining a table whose first picture is not behind it, what the bitmap behind the stream
says about itself, a picture of twenty four bits written as the bitmap it unfolded to, the first picture of a
file holding several, a picture of thirty two bits whose rows are turned, and a stream cut short of its
picture.
