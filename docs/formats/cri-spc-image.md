# CRI compressed texture format

Reference: `GARbro/ArcFormats/Cri/ImageSPC.cs`, class `SpcFormat`, over `XtxFormat` in
`ArcFormats/Cri/ImageXTX.cs`. GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/cri/spc-image.ts` (`criSpcImageDescriptor`, `criSpcImageFormat`, id
`cri-spc-image`, `readSpcSize`, `unpackSpc`), standing over `cri/xtx-image.ts`.

This stands as the texture of the CRI MiddleWare kind that stands behind a walk of places of its own, and it
stands beside the container of the same engine that the reference reads in `ArcFormats/Cri/ArcSPC.cs` under the
tag `SPC/CRI`, which the project reads as `cri-spc`. Both kinds of file begin with the same four places — how
many places the places behind them stand for — and tell themselves apart by the places behind those: a texture

## The head and the walk

The first four places name how many places the texture holds, read the little way round; the reference reads
fewer, or of more places than `0x5000000`, stands as no texture at all.

The texture stands behind those four places, walked: the walk is the one the reference walks as
`GameRes.Compression.LzssStream`, whose places stand as nothing to begin with, whose own first place stands at
`0xFEE`, whose places stand in a frame of `0x1000` places, and whose every step names eight places of its own,
one place of a colour standing as a place of the file and two places of a colour naming how far behind and how
many places stand beside them.

## Deviations from the reference

- The reference reads the walked part of the file to its end before reading the head of the texture; this port
  of the file to tell whether the places behind them stand as a texture. A walk hands out at least one place of
  the texture than the largest head of a texture may stand behind, and how the places behind them are read
  stands as the reference reads them.
- A file whose first four places name no texture, a file that stands as no texture behind those places, and a
  texture of the second kind of tiling are turned away; the reference would throw while reading them.
  the reader of the textures of the engine; the places are walked and a bitmap header is written around them,

## Tests

stood against what the reader of the textures of the engine hands out for the same places — a texture whose
head stands behind a size of its own, the walked parts that name no texture, a texture of the second kind of
