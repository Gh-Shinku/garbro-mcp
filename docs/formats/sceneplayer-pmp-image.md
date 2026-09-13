# ScenePlayer PMP compressed bitmap

Reference: `GARbro/ArcFormats/ScenePlayer/ImagePMP.cs`, class `PmpFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/sceneplayer/pmp-image.ts` (`pmpImageDescriptor`, `pmpImageFormat`, id
`sceneplayer-pmp-image`).

A **bitmap inside a zlib stream, masked with a single byte**: every byte of the file is exclusive ored with
`0x21`, so the stored first byte is a *masked* zlib CMF — `0x78 ^ 0x21`, which is `0x59`. That relation is
asserted by a test rather than by comparing against a constant, and a test also re-masks a stored file to
recover a stream that the standard library can inflate. This is the third masked-stream port, after the WRG
audio and GRA bitmap readers.

Detection is the interesting part. The reference declares **no signature and no extension gate**, so every
file is a candidate and the only check it makes before decompressing is the single masked CMF byte — one value
in 256. Acceptance therefore rests on the decompression succeeding and on the payload being a readable bitmap,
and the port reproduces that shape: `signatures: []`, a first-byte test, then a capped inflate, then
`readBmpMetaData`. A test drives each failure separately — a non-bitmap payload, a wrong first byte, a file
stored *without* the mask (where the first byte is the plain CMF and the mask check rejects it), a corrupted
stream, and a one byte file.

The port exposes the resource as a single entry:

* decompression uses the shared `inflateZlibBufferCapped`, the helper added for the Kurumi GRA port, with a cap
  of 256 MiB. The reference imposes no cap; the bound is a documented deviation, and it matters more here than
  elsewhere because detection decompresses for *every* candidate file;
* the inflated payload is validated with the shared `readBmpMetaData` and trimmed to the bitmap's own `bfSize`,
  the usual rule for a container that declares one size and holds an object that declares another. A test gives
  the bitmap sixteen bytes of slack and asserts that the output is the bitmap, not the slack;
* the entry is named after the source file with a `bmp` extension, covers the whole stored file, and is flagged
  `encrypted: true` and `compressed: true` with `sizeKnown: false`;
* entry metadata carries `type: "image"`, the dimensions and the bitmap's bit depth; the archive metadata
  records `image: "bmp"`, `compression: "zlib"`, `encrypted: true` and the dimensions.

Unlike most ports in this repository, GARbro *can* write this format: `PmpFormat.Write` masks a level nine zlib
stream produced from `Bmp.Write`. Encoding is out of scope here, so `create` stays false, but the reader is the
complete half of a symmetric pair.
