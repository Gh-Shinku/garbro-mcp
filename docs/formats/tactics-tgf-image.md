# Tactics graphics file

Reference: `GARbro/ArcFormats/Tactics/ImageTGF.cs`, classes `TgfFormat`, `TgfMetaData` and `Reader` (Tactics
graphics file). GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/tactics/tgf-image.ts` (`tacticsTgfImageDescriptor`,
`tacticsTgfImageFormat`, id `tactics-tgf-image`, `unpackTgf`, `readTgfLayout`).

The reference registers no signature, so every file that reaches it is tried against the header walk: a word
saying how long the **bitmap** is, a word saying how long a **chunk** of it is, and then a stream of chunks.

The reference accepts only a bitmap of up to `0xFFFFFF` bytes, at least as long as one chunk, with a chunk of
more than nothing; anything else declines the file.

## The stream

Chunks are steered by a byte:

* a byte of **zero** reads a length and as many bytes behind it;
* a byte of **one** reads a count and as many **chunks** behind it, so the run is that count times the chunk
  length;
* anything else is a run of whole chunks: one chunk is read and then repeated until the byte is used up, so the
  byte is how many copies of that chunk the run holds.

A run of bytes is cut short where the bitmap ends, and a chunk that would reach past the end of it is where the
stream **stops**, leaving the rest of the picture as it was found, which is zeroes. A stream that ends early
leaves the rest of the picture alone in the same way, and the reference reads it as far as it goes.

The measurements come out of a buffer the reference fills only as far as `max(0x20, chunk + 2)` bytes, which is
enough for the bitmap header of a chunk of at least fifty two bytes; a smaller chunk therefore cannot carry the
header the reference then reads — it reads past its own buffer there — and this port declines such a file.

## What comes out

The whole stream is unfolded into a bitmap, which is read and written out again at the depth it was stored in.

Nothing here writes the format: `TgfFormat.Write` is not implemented in the reference either.

The tests cover the header walk and the four ways it declines a file, the measurements and the name of the
entry, a picture written as runs of bytes, one written as runs of whole chunks, a picture whose colour map is a
repeated chunk and one whose copy stops where the picture ends, and a stream that ends early.
