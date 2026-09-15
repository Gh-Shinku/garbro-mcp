# Melody compressed bitmap

Reference: `GARbro/Legacy/Melody/ImageMGO.cs`, classes `MgoFormat`, `MgoMetaData` and `LzssDecompressor`
(Melody compressed bitmap). GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/melody/mgo-image.ts` (`melodyMgoImageDescriptor`,
`melodyMgoImageFormat`, id `melody-mgo-image`, `inflateMelodyLzss`, `readMgoHeader`).

A file carries the word `MGOB`, the word five at offset four, and at offset eight the length of the picture the
stream behind the header unfolds into. What unfolds is a name, a table, and then a Windows bitmap.

## The stream

The compression is **not** the LZSS that the rest of GARbro reads: its control bits are taken one at a time from
a stream whose next bit is the lowest bit of the byte it is held in, and a run is named by an **absolute** place
in a ring of four thousand and ninety six bytes rather than by a distance back from what has been written.

* the control bit one reads eight bits, which is a literal byte, and bit zero reads twelve bits naming a place in
  the ring and four bits that are the length of a run less two, so a run is two to seventeen bytes long;
* every byte written, literal or run, is also written into the ring, which starts **empty** one place in rather
  than holding spaces, so a run that names a place nothing has reached yet copies zeroes;
* a field that runs past the end of the stored data ends the stream, and the bits already gathered for that
  field are thrown away with it. The one place the reference reads past the end is the byte of a literal, which
  it casts to a byte regardless, so that one byte becomes `0xFF`.

## The picture

The unpacked stream is walked for the header of the entry: a name up to its terminator, a position aligned to
four bytes **counting that terminator**, a count of entries, that many sixteen byte entries, and then the header
of the bitmap. The bitmap itself is read from that place and written out at the depth it was stored in.

Two things the reference does are answered with an error here:

* a picture that declares more than 256 MiB, which the reference would stream rather than hold, is
  `LIMIT_EXCEEDED`;
* a name longer than 1 KiB ends the walk rather than being read to the end of the picture.

Nothing here writes the format: `MgoFormat.Write` is not implemented in the reference either.

The tests cover finding the word and refusing a version that is not five, the measurements and the name of the
entry, a picture written a byte at a time, a run taken from a named place in the ring, the filler the alignment
leaves behind a five byte name, a stream that stops before its bitmap, and a declaration too large to hold.
