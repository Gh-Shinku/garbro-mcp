# Favorite View Point image format

Reference: `GARbro/ArcFormats/Favorite/ImageHZC.cs`, classes `HzcFormat`, `HzcMetaData` and `HzcDecoder`.
GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/favorite/hzc-image.ts` (`favoriteHzcImageDescriptor`,
`favoriteHzcImageFormat`, id `favorite-hzc-image`, `readHzcLayout`).

The file begins with the word `hzc1`, and the head the reference reads is forty four bytes long. Its four
bytes at `0x0C` must be `NVSG`, and behind them stand the kind of the picture at `0x12`, its measurements at
`0x14` and `0x16` and its placement at `0x18` and `0x1A`. The size of the unpacked picture stands at four and
the reach of the head at eight. The kind decides the depth:

| kind | depth | pixels |
| --- | --- | --- |
| `0` | 24 | blue, green, red |
| `1`, `2` | 32 | blue, green, red, alpha |
| `3` | 8 | a ramp of greys |
| `4` | 8 | two colours, black and white |
| above `4` | — | refused, as the reference's own decoder refuses them |

The pixels are a zlib stream that begins twelve bytes plus the head's own reach into the file, and it has to
unfold to exactly one picture of the declared size; the reference's own `ReadPixels` asks for that many bytes
and answers a stream that holds less with an exception, and so does this port. The decoder is written to walk
several frames of one uncompressed size for the entries of an archive, but `HzcFormat.Read` builds it with a
frame offset of nothing and a frame size of the whole picture, so only the first frame is ever read; this port
reads that one frame too.

The fourth kind is the only one the reference gives a colour map of its own, a two entry palette of black and
white. This port writes it out through the shared eight bit writer, which rounds the map out to a full two
hundred and fifty six entries with the two colours first; the reference's own encoder writes its map in a form
of its own, so the two byte orders are not compared here. The placement the head declares is carried into the
entry and archive metadata and is not applied to the written picture, which is what the reference does as
well.

The tests cover the head the reference reads, the depth of each kind, the signature and the tag, the three
pixel layouts written out, the measurements and the placement the port reports, a kind the decoder refuses,
and a stream that unfolds short of the picture.
