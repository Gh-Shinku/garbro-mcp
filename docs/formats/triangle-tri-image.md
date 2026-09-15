# Triangle image

Reference: `GARbro/ArcFormats/Triangle/ImageTRI.cs`, classes `TriFormat` and `TriMetaData` (Triangle image
format). GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/triangle/tri-image.ts` (`triangleTriImageDescriptor`,
`triangleTriImageFormat`, id `triangle-tri-image`).

A file carries the word `TRIz` and, at offset four, the length of the picture it unfolds into, exclusive-ored
with `0x65641538`. What unfolds is a Windows bitmap, so the measurements of the entry come from the header of
that bitmap rather than from the file around it.

## The stream

Reading is steered by the bits of a control word, which the decoder pulls in as it needs them and consumes from
the **highest** bit down; a bit that is clear reads one byte, and a bit that is set names a run of what the
picture already holds.

* a **clear** bit reads a byte and exclusive-ors it into a running key which starts at `0x7F`, and the picture
  holds the key rather than the byte, so the stream stores differences;
* a **set** bit reads a word. The word is added to what is left of the control word, which is what carries the
  highest bits of a long distance, and the sum holds the distance in its lowest twelve bits and the length in
  the four above them. The distance counts **backwards from one**: the run is taken from `written - distance - 1`;
* a length of zero in those four bits means the run is a long one: the byte behind the word, added to the key
  the previous byte left behind, is the length less fifteen. A length of zero **there** ends the stream, and the
  rest of the picture stays as it was found, which is zeroes;
* the length is then taken up by two and cut short at the end of the picture, and the run repeats what it has
  already written, so a run may carry on from itself.

## What comes out

The picture is unfolded twice. Once as far as fifty six bytes, which is enough of a bitmap header for the
measurements the entry reports, and once in full, and the whole of it is read back as a bitmap and written out
at the depth it was stored in. A picture whose stream ends before its fifty six bytes is not a picture this
format claims.

Two things the reference does are answered with an error here:

* a run that reaches behind the beginning of the picture, where the reference would raise an index error, is
  `INVALID_ARCHIVE`;
* a picture that declares more than 256 MiB, which the reference would try to allocate, is `LIMIT_EXCEEDED`.

The format has no writer in the reference either: `TriFormat.Write` is not implemented.

The tests cover finding the word and refusing a body that ends too early, the measurements and the name of the
entry, a picture written a byte at a time, a run of the short form and one long enough to need its own length
byte, a run that cancels its own length and ends the stream, a run that reaches behind the picture, a stream
that ends before the picture does, and a declaration too large to hold.
