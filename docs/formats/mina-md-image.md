# Mina compressed bitmap

Reference: `GARbro/Legacy/Mina/ImageMD.cs`, class `MdFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/mina/md-image.ts` (`mdImageDescriptor`, `mdImageFormat`, id
`mina-md-image`).

A **compressed bitmap**: the file starts with `MD`, then eight bytes GARbro skips, and from `0xA` an
**LZSS stream** (GARbro's default `LzssStream` variant — 0x1000 byte frame, zero fill, initial position
`0xFEE`, set control bit meaning literal, matches from three bytes up). What comes out is a Windows
bitmap, which is why the reference hands the decompressed stream straight to `Bmp.ReadMetaData`.

The port exposes the resource as a single entry:

* detection needs the `MD` tag, a payload after the ten byte prefix and a decompressed payload that
  parses as a bitmap: `BM`, a `bfSize` between 54 and the decompressed length, a
  `BITMAPINFOHEADER` (DIB size `>= 40`), non-zero width and non-zero height. Only the standard header
  is accepted — an OS/2 core header (`DIB size 12`) is declined, a documented deviation;
* extraction decompresses the payload and **trims it to the `bfSize` the bitmap states**, so trailing
  bytes of the stream are ignored. GARbro decompresses on demand as its reader asks for bytes, which
  reaches the same result for a well formed file;
* the entry is named after the source file with a `bmp` extension, is flagged `compressed: true` and
  `sizeKnown: false`, because the stored LZSS payload and the extracted bitmap differ in length;
* metadata carries `type: "image"` plus the bitmap's width, height and bit depth, and the archive
  metadata records `image: "bmp"` and `compression: "lzss"`.

Two further deviations: the decompression is bounded by a 64 MiB cap so that a hostile header cannot
demand an unreasonable allocation, and a corrupt stream is declined rather than propagated.

Pixel decoding and archive creation are out of scope.
