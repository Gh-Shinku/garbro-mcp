# Xbox 360 texture format

Reference: `GARbro/ArcFormats/Cri/ImageXTX.cs`, classes `XtxFormat`, `XtxMetaData` and `XtxReader`, with the
block decoder of `ArcFormats/DirectDraw/DxtDecoder.cs`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/cri/xtx-image.ts` (`criXtxImageDescriptor`, `criXtxImageFormat`, id
`cri-xtx-image`, `readXtxLayout`, `tiledRow`, `tiledColumn`, `unpackXtx`).

The file begins with the four bytes `xtx` and a nought — the word the reference registers — or, where it does
not, with a size of four bytes that stands at less than `0x1000` and the head stands behind that many bytes.
That second shape is why the format stands beside its word with an extension as well, since a file of it
carries no word at all in front of it. The kind of tiling stands at four and has to be two or less, the width
and the height the tiling stands on at eight and `0x0C` as words read the long way round and both standing
above nought, the width and the height of the picture at `0x10` and `0x14`, and the two places the picture
stands at within the tiling at `0x18` and `0x1C`. The pixels stand behind the head of thirty two bytes.

The pixels of the picture do not stand in the order of the picture but in an order two walks of the tiling
give: `GetY` and `GetX` read how far into the tiling a pixel stands and how wide the tiling is and answer the
row and the place along it, at one of three steps of tiling. The walks are the ones the reference took from
the tooling of the engine itself, with their own constants and their own divisions, and are kept here as they
stand. A picture whose head gives an aligned size wider than thirty two pixels has its tiling reach beyond
what the reference walks, and the pixels the walks do not reach stand as nought.

Three kinds of tiling are named. The first stands a pixel at every place of the tiling, four bytes a pixel
with the four bytes **turned back to front**. The third stands a block of the fifth kind of block at every
place — sixteen bytes with **every word of two bytes turned around** — and hands the blocks to the shared
decoder of that kind. The second kind is read by the reference and then handed to its caller as a
`NotImplementedException`, so the port turns it away with a message of its own.

The picture the port hands out stands **top down**, which is what `ImageData.Create` means, and the write path
of the reference throws `NotImplementedException`, so this is a read only format.

Deviations from the reference, in the message only: a picture cut short of its pixels or its blocks, a kind of
tiling or a size that does not hold, and the second kind of tiling are refused, where the reference would read
outside its own array or throw an exception of its own.

The tests cover the head in both of its shapes and the word that finds one of them, the marks, the kind of
tiling and the sizes it is turned away for, the two walks of the tiling against places worked out by hand from
the reference and against a whole tiling of thirty two by thirty two pixels standing once and only once, the
pixels of the first kind of tiling turned back to front, a block of the fifth kind with its words turned
around, the second kind of tiling, a picture cut short of its pixels, and a file that does not hold a picture.
