# 'Unknown' image format

Reference: `GARbro/Legacy/Unknown/ImageCTF.cs`, classes `CtfFormat`, `CtfMetaData` and `CtfReader`. GARbro
commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/unknown/ctf-image.ts` (`unknownCtfImageDescriptor`,
`unknownCtfImageFormat`, id `unknown-ctf-image`, `readCtfLayout`, `unpackCtfRle`, `unpackCtf`).

The file begins with the word `CTFF`; the width and the height stand at four and six as words, the size of
the planes at twelve, the places of the red, the green, the blue and the alpha plane from sixteen, and the
depth at `0x20` — which has to be twenty four bits whether or not the alpha plane stands behind it. A place
of the alpha plane that is not nought is what makes the picture thirty two bits a pixel. The byte at `0x22`
says whether the stream was packed, which the reference notes and then does not use: it always reads an LZSS
stream, of its own kind, from `0x48`.

`CtfReader.UnpackRle` then unfolds the planes from a run walk. Behind a head of twenty four bytes — whose
sixth byte is the count a run has to reach before another byte may say how much longer it is — a run stands
as its own byte, as many times as follow it up to that count. When the count is reached, another byte says
how much longer the run is: below `0x80` it says so itself, and above it two bytes say so together in the
shape `((ctl & 0x7F) << 8) + lo + 0x80`.

The three or four planes are then woven together a pixel at a time — blue, green, red and, where there is
one, the alpha of that pixel — into rows of the picture's own stride, which is the width in bytes rounded up
to four. The rows are handed out top down, which is what `ImageData.Create` means.

Deviations from the reference, in the message only: a plane that stands outside the planes the head declares
is refused rather than left to the walk, and a run that reaches past the planes or a stream that ends inside
the walk is refused with a message of this project's own. The write path of the reference throws
`NotImplementedException`, so this is a read only format.

The tests cover the head of both depths, the fields the reader is turned away for, the walk of runs up to the
count and behind it, the twenty four bit picture written out with its planes reordered, and the alpha plane
woven into a thirty two bit one.
