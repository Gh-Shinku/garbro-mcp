# KeroQ image format

Reference: `GARbro/Legacy/KeroQ/ImageKGD.cs`, classes `KgdFormat`, `KgdMetaData` and `PngRestoreStream`.
GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/keroq/kgd-image.ts` (`keroqKgdImageDescriptor`, `keroqKgdImageFormat`,
id `keroq-kgd-image`, `readKgdLayout`, `adler32`, `restoreKgdPng`).

The file is a picture of the Portable Network Graphics kind that has lost its eight byte signature and its
header and had its stream cut into pieces. Its own head is twenty five bytes long: the word `\x89KGD` — the
word the reference registers — stands ten at four and one at eight, the width and the height stand at nine and
`0x0D` as words, and the bits of a plane and the kind of picture at `0x11` and `0x12`. The kind says how many
bits a pixel takes: nought leaves the bits of a plane as they are, two trebles them, three means twenty four
bits a pixel, four doubles them and six takes them four times over.

Behind the head every piece of the stream stands behind a word of its size and a kind byte of two — the kind
byte of a chunk of the stream. `PngRestoreStream` puts the picture back together: the eight bytes of the
signature, a header of thirteen bytes holding the width, the height, the bits of a plane, the kind of picture
and three bytes of nought, and then a chunk for every piece, the size being the one the piece really holds.
Where the file ends a chunk of nought bytes named `IEND` stands, behind the checksum `0xAE426082`.

The checksum the reference stands behind the two kinds of chunk it writes itself is **Adler's**, the one of a
compressed stream, rather than the one the kind of picture asks for — its own decoder does not look at it, and
the port keeps the reference's bytes rather than a picture a stricter reader would take.

What the port hands out is the picture the reference has put back together. The reference goes one step
further and decodes it with a decoder of the kind of picture — and swaps the red and the blue of every pixel
of a picture of more than two bytes a pixel, which is a turn of that decoder's own byte order rather than
anything the file says. The port keeps the stream as it stands.

Deviations from the reference, in the message only: a piece whose kind byte is not the one of the stream, a
piece that does not stand inside the file, and a head cut short of its own size are refused. The reference
would hand a stream that ends where the piece begins to its decoder and let it fail there.

The tests cover the head and every kind of picture it may name, the marks it is turned away for, the checksum
of the compressed stream, the putting back of the signature, the header, the pieces and the end, several
pieces in the order they stand in, a piece that is not part of the stream, a piece that does not stand inside
the file, and a file that does not hold a picture.
