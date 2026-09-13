# Silky's compressed bitmap

Reference: `GARbro/ArcFormats/Silky/ImageGRD.cs`, class `GrdFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/silky/grd-image.ts` (`grdImageDescriptor`, `grdImageFormat`, id
`silky-grd-image`).

A **compressed bitmap**: the file starts with `CMP_` (`0x5F504D43`), then eight bytes GARbro skips, and
from offset **12** an **LZSS stream** whose output is a Windows bitmap — the reference hands the
decompressed stream straight to `Bmp.ReadMetaData`, exactly like the MD format does.

The distinguishing detail is the ring buffer fill: `DecompressStream` sets `FrameFill = 0x20` after
constructing the stream (`LzssCoroutine.Unpack` reads the setting lazily, so the assignment takes
effect), which means a back reference into a part of the ring that has not been written yet yields
**spaces, not zeros**. Everything else is the LZSS default (0x1000 byte frame, initial position
`0xFEE`, set control bit meaning literal, matches from three bytes up). A test pins this down: the same
hand written stream decodes to a bitmap containing three `0x20` bytes with the fill in force and to three
zero bytes without it.

The port exposes the resource as a single entry:

* detection needs the `CMP_` tag, a payload after the twelve byte prefix and a decompressed payload that
  parses as a bitmap: `BM`, a `bfSize` between 54 and the decompressed length, a `BITMAPINFOHEADER` (DIB
  size `>= 40`), non-zero width and non-zero height. Only the standard header is accepted — an OS/2 core
  header (`DIB size 12`) is declined, a documented deviation;
* re-checking the tag is a deviation too: `ReadMetaData` checks nothing itself and relies on the registry
  gate, so without it `detect` would claim any file whose payload happens to decompress into a bitmap;
* extraction decompresses the payload and **trims it to the `bfSize` the bitmap states**, so trailing
  bytes of the stream are ignored;
* the entry is named after the source file with a `bmp` extension, is flagged `compressed: true` and
  `sizeKnown: false`, because the stored LZSS payload and the extracted bitmap differ in length;
* metadata carries `type: "image"` plus the bitmap's width, height and bit depth, and the archive
  metadata records `image: "bmp"` and `compression: "lzss"`.

Decompression is bounded by a 64 MiB cap so that a hostile header cannot demand an unreasonable
allocation, and a corrupt stream is declined rather than propagated.

Pixel decoding and archive creation are out of scope.
