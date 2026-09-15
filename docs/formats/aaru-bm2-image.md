# Aaru bitmap format

Reference: `GARbro/Legacy/Aaru/ImageBM2.cs`, classes `Bm2Format` and `Bm2Reader`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/aaru/bm2-image.ts` (`aaruBm2ImageDescriptor`, `aaruBm2ImageFormat`, id
`aaru-bm2-image`, `readBm2Layout`, `unpackBm2`).

The file begins with the word `BM2A` and a header of twenty two bytes behind it: the depth as a word at eight —
**eight or twenty four bits only** — the place of the picture as two words at ten and twelve, and its
measurements as words at fourteen and sixteen. `ReadMetaData` reads nothing else, so a file whose pixels are
cut short is claimed there and refused when it is read; the reference builds an empty image from a width or
height of nothing, which nothing can be drawn from, so such a header is declined here.

The pixels behind the header are **thirty two bit either way**, because the reader always builds `Bgra32`, and
their rows are kept in the order they are stored, top row first:

* an **eight bit** picture carries a colour map of two hundred and fifty six four byte entries first, and then
  two bytes to a pixel — a transparency and then an index into that map;
* a **twenty four bit** picture carries **four** bytes to a pixel, taken as a whole block and turned so that
  the first of them is the transparency and the three behind it are the colours.

A colour map the file does not hold whole, or an eight bit picture cut short of its pixels, is refused with
`INVALID_ARCHIVE`, where the reference's own reading would throw. The reader of a twenty four bit picture reads
into the same four byte block over and over and keeps what the last block left there, so a stream that ends
inside a block fills the pixels behind it with the block before them — the whole of it, or the part of it the
stream did not reach — which is what the reference does as well. A picture above `0x10000000` bytes is refused
with `LIMIT_EXCEEDED`, where the reference would allocate and fail. Nothing here writes the format.

The tests cover finding a picture behind the word of the format, declining each depth the reference does not
read, what the header says with the place of the picture, a twenty four bit block turned into a pixel, the
colour and transparency of an eight bit pixel, the rows staying in the order they were stored, a stream cut
short inside a block, an eight bit picture cut short of its pixels, and one cut short of its colour map.
