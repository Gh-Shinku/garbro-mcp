# Scoop compressed bitmap

Reference: `GARbro/ArcFormats/Scoop/ImageSCP.cs`, class `ScpFormat` (Scoop compressed bitmap). GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/scoop/scp-image.ts` (`scoopScpImageDescriptor`, `scoopScpImageFormat`,
id `scoop-scp-image`, `readScpLayout`, `unpackScp`).

A file carries the word `SCPz` and, behind it, the length of the picture the stream unfolds into, turned by a
word of its own (`0x65641538`). A length of nothing is not a picture and declines the file. The picture itself
is a **bitmap**, and its measurements come out of the fifty four bytes of the bitmap header the reference
unfolds to read them; a stream that unfolds to something that does not open with `BM` is not one this format
claims.

## The stream

The stream carries a control word of four bytes and, behind each bit of it, the byte or the word of one opcode.
The bits are read from the **highest** one down:

* a clear bit reads a byte, turns it by a key and writes the result out, keeping it as the key of the next one;
* a set bit reads a word naming a run, the length of the run riding in the four bits above its place, and both
  counted from one rather than from nothing.

A run whose length is **zero** takes its length from the byte behind the word, added to the key of the literal
before the last one; a length that works out to nothing ends the stream, leaving the rest of the picture as it
was. Every run is copied from a place counted back from where the picture is being written, and a run that
reaches back before the picture, or past the end of it, is refused with `INVALID_ARCHIVE`.

Two quirks of this variant are worth naming, because the Triangle engine's stream, which looks much like it,
does not share them. The word of a run is added to the control word as a **word**, so the sum wraps at sixteen
bits rather than carrying into the distance. And when the control word runs out, the bit that was read on the
way out of it is **spent without being acted upon**: the decoder reads the next word and starts again from its
highest bit.

Nothing here writes the format: `ScpFormat.Write` is not implemented in the reference either. A stream that
ends inside an opcode is refused with `INVALID_ARCHIVE`, as is a picture that unfolds to something other than
a bitmap, one larger than 256 MB with `LIMIT_EXCEEDED`, and one of no width or no height with
`UNSUPPORTED_FEATURE`.

The tests cover finding the word and the length behind it, the measurements and the name of the entry, a
picture written a byte at a time, a run repeating what the picture holds, the length a long run carries in the
byte behind its word, a run reaching back before its picture, a stream that stops before the picture is whole,
and one that ends inside an opcode.
