# BANANA Shu-Shu image format

Reference: `GARbro/ArcFormats/Banana/ImageMAG.cs`, classes `MagFormat` and `MagMetaData`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/banana/mag-image.ts` (`bananaMagImageDescriptor`, `bananaMagImageFormat`,
id `banana-mag-image`, `readMagLayout`, `unpackMag`).

The reference declares no signature, and the head is what tells a picture apart from anything else. Its
thirty six bytes hold the rectangle of the picture — its left, top, right and bottom edges as signed words —
the canvas it is placed on at `0x18` and `0x1C`, and the offset of the alpha stream behind the head at `0x20`.
The two words at `0x10` and `0x14` must be nothing, the rectangle must lie inside the canvas, and the canvas
may not be larger than `0x2000` in either direction, all measured with signed comparisons. The depth is
thirty two bits when an alpha stream is declared and twenty four when it is not, and the placement is carried
into the entry and archive metadata as the offsets the reference reports.

The pixels are an LZSS stream of three bytes per pixel that has to unfold to exactly the rectangle; the
reference's own `LzssStream` is the plain twelve bit variant with a four kilobyte frame and its place
beginning at `0xFEE`, which the shared codec reads with the size it is given. A stream that unfolds short of
the rectangle is refused, which is what the reference's own length check does as well. The unfolded bytes are
then walked twice, each byte the sum of itself and one before it, held to eight bits:

* along the first row, every byte behind the third is the sum of itself and the byte three before it;
* from the second row on, every byte is the sum of itself and the byte a whole row before it, which carries
  the row walk above into every row below.

An alpha channel is a second LZSS stream of one byte per pixel of the **canvas**. The picture's own alpha is
read from where the rectangle lies on the canvas, bottom row first, and the picture is written out as thirty
two bit blue, green, red, alpha rows in that order, which is what `ImageData.Create` keeps. Without an alpha
channel the pixels are written out as a twenty four bit picture whose rows are stored bottom up, which is
what `ImageData.CreateFlipped` means. The placement the head declares is not applied to the written picture:
the reference hands out the rectangle alone and reports the offset separately, and so does this port.

The tests cover the head the port reads, the declines of a set reserved word, of a rectangle outside the
canvas, of a canvas larger than `0x2000` and of a picture of no size, the measurements and the placement the
port reports, a picture unfolded through the delta walk into a bitmap of bottom up rows, an alpha channel
read from the canvas the picture lies on, a stream that unfolds short of the picture, and the two walks
turned by a stream of ones.
