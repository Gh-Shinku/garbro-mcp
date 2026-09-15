# Riddle Soft compressed bitmap

Reference: `GARbro/ArcFormats/RiddleSoft/ImageGCP.cs`, classes `GcpFormat`, `GcpMetaData` and `CmpReader`
(Riddle Soft compressed bitmap). GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/riddle/gcp-image.ts` (`riddleGcpImageDescriptor`,
`riddleGcpImageFormat`, id `riddle-gcp-image`, `unpackGcp`, `readGcpLayout`).

A file carries the word `CMP1`, the length of the picture the stream behind it unfolds into, and the length of
that stream. A picture shorter than a bitmap header is not one this format claims.

## The stream

Bits are read from the **highest** bit of the byte they are held in down:

* a set bit reads eight bits, which is a literal byte;
* a clear bit reads eleven bits naming a **place in a ring** of two thousand and forty eight bytes and four
  bits that are the length of a run less two, so a run is two to seventeen bytes long.

The ring is written one place at a time from place `0x7EF` and it holds **spaces** before that place, so a run
that names a place nothing has reached yet copies spaces. Two places at the end of the ring stay zero. The
stream reads no more bytes than its own length declares, and it stops where the picture ends.

## The picture

The measurements come out of the first thirty four bytes of the picture, which is as much as the reference
unfolds to read them: the width and height from the header of the bitmap, and the depth from the word that
follows them. A measurement that cannot be a picture — a width or height of nothing, or a depth of nothing —
declines the file here, where the reference would accept the file and fail later.

The whole stream is then unfolded into a bitmap and written out at the depth it was stored in, with one
exception the reference names: a bitmap of twenty four bits whose width is **not** a multiple of four and whose
picture is exactly `height * width * 3 + 54` bytes long is stored **without** the padding every other bitmap
carries, and its rows the other way up, so the port reads it row by row and turns it over.

Nothing here writes the format: `GcpFormat.Write` is not implemented in the reference either.

The tests cover finding the word and the three ways its header declines a file, the measurements and the name of
the entry, a picture written a byte at a time, a run taken from a place in the ring, the spaces the ring holds
before anything is written, a bitmap stored without row padding, and a stream that stops before the row behind
its header.
