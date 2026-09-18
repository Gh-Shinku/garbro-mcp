# Cadath image format

Reference: `GARbro/ArcFormats/Cadath/ImageCGF.cs`, classes `CgfFormat`, `CgfMetaData` and `CgfDecoder`.
GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/cadath/cgf-image.ts` (`cadathCgfImageDescriptor`, `cadathCgfImageFormat`,
id `cadath-cgf-image`, `readCgfLayout`, `decryptCgf`, `unpackCgfRle`, `unpackCgf`).

The file begins with the word `CGF` and a nought of its own — the word the reference registers — the walk
stands at four, the depth at five, and the width and the height at six and eight as words. The walks are one,
two and three and the depths twenty four and thirty two bits; a picture of another depth is turned away.

The planes stand one behind another from `0x0A`, every one of them behind a word that says how many bytes it
holds. The first walk reads every plane as a **scrambled** zlib stream, the second reads them as runs, and the
third reads them as a plain zlib stream whose bytes are then exclusive ored one after another. Every plane is
unfolded into a plane of its own and the planes are then woven together a pixel at a time: the first plane is
the first byte of every pixel, the second the one behind it, and so on.

`CgfDecoder.Decrypt`, which the runs of a Cadath archive and the VWF sound of the same engine share as well,
reads the stream as words and exclusive ors every one of them with a key that turns three places to the left
before every word and then climbs by the seed `0x3977141B` again. `UnpackRle` reads the size of the plane as a
word at nought and then the runs: a byte stands itself, and where it is the same as the byte before it a count
stands behind it and the byte is written once more for every step of that count.

The rows are handed out top down, which is what `ImageData.Create` means. The write path of the reference
throws `NotImplementedException`, so this is a read only format.

Deviations from the reference, in the message only: a plane whose length is negative, a plane that does not
stand inside the file, a run that reaches past its plane, and a stream that is cut short of its runs or its
planes are refused, where the reference would throw an `EndOfStreamException` or read past its own array. The
scrambling walk keeps exactly the bytes a stream holds, where the reference writes a whole word at a time and
would reach past a stream whose length is not a multiple of four; the bytes it would have written beyond the
stream are never read by any walk of this engine.

The tests cover the head, the marks, the walk and the depth it is turned away for, the scrambling walk as its
own inverse, the runs of a byte and the byte before it, the two zlib walks, the weaving of three planes, and
a file that does not hold a picture.
