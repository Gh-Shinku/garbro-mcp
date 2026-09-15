# BELL-DA compressed bitmap

Reference: `GARbro/ArcFormats/BellDa/ImageCP.cs`, classes `CpFormat` and `CpLzssDecompressor`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/bellda/cp-image.ts` (`bellDaCpImageDescriptor`, `bellDaCpImageFormat`,
id `bell-da-cp-image`, `cpUnpack`).

The reference registers the word of a whole tag beside one of nothing, so the format is a candidate for every
file and the tag inside the file is what tells it apart: the file begins with `'CP'`, then a byte whose **two
high bits must be set**, then `'BM'` — the tag of a Windows bitmap. That byte is also the **first control byte
of the packed stream**, which begins one byte behind the tag, so a file whose first control byte does not have
those bits set is turned away by the reference. What the stream unfolds to — through `Bmp.ReadMetaData` and
`Bmp.Read` — is a Windows bitmap, which this port reads with the shared bitmap reader and writes out again at
the depth it was stored in, as the other bitmap ports here do.

The stream is the usual twelve bit LZSS with a frame of four kilobytes, filled with nothing, but its control
bits are read from the **highest down** and its frame place begins **one byte in**, which is where the first
literal stands:

* a set control bit is a literal byte, written into the frame where the frame place stands and out to the
  picture;
* a clear one is a run: the two bytes behind the control hold its place in the frame — the high half of the
  second byte holds its low eight bits — and its count, from three to eighteen, in the low half of the second
  byte. The run is copied **forwards**, so it may read bytes it has just written, and every place in the frame
  is held to its twelve low bits.

A stream that stops in the middle of a literal or a run gives up there, which the reference's enumerator does
as well; the port unfolds the stream as far as the picture needs and no further. The picture is held to 64 MB
(a documented guard against a hostile stream, as in the other LZSS bitmap ports here).

The tests cover the tag and the two high bits of the byte behind it, a file that does not hold a bitmap,
the measurements of the bitmap behind the stream, the bitmap written out again, a stream that stops before the
bitmap is whole, and — of the stream itself — the frame beginning one byte in, a run reading what it has just
written, the count of a run and a stream that gives up.
