# Studio Nekopunch PBM bitmap

Reference: `GARbro/ArcFormats/Nekopunch/ImagePBM.cs`, class `PbmFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/nekopunch/pbm-image.ts` (`pbmImageDescriptor`, `pbmImageFormat`, id
`nekopunch-pbm-image`).

An **LZSS compressed bitmap** whose header fields are themselves part of the compressed stream. This is the
same shape as the ADVGSys port: byte four of the file is the stream's first control byte, and the `BM` the
reference checks at bytes five and six are the first two bytes that control byte introduces. The reference
requires the low three bits of the control byte to be set — which a stream of eight literals satisfies via
`0xFF` — and then checks that the decompressed payload begins with `BM`. Two tests confirm that the marker
really is a consequence of the compression: clearing the low bits is declined, and compressing something that
is not a bitmap is declined too.

| field | offset |
|---|---|
| unpacked size (`u32`) | 0 |
| LZSS stream | 4 |

The port exposes the resource as a single entry:

* decompression uses the shared `inflateLzssAll` with default GARbro settings and a cap taken from the
  declared size, which is what `LimitStream` enforces in the reference. A stream that produces less than the
  declared size is **zero padded**, again matching `LimitStream` with `StreamOption.Fill`, so a truncated
  bitmap fails the metadata check rather than the decode — a test stores only sixteen bytes of the bitmap and
  expects a decline;
* the padded payload is validated with the shared `readBmpMetaData` and the output is trimmed to the
  bitmap's own `bfSize`. This is the third port where the container's declared size and the bitmap's size are
  distinct numbers, and a test gives the bitmap sixteen bytes of slack to show the declared size does not
  survive into the output;
* the entry is named after the source file with a `bmp` extension, covers the whole stored file, and is
  flagged `compressed: true` with `sizeKnown: false`;
* entry metadata carries `type: "image"`, width, height and the bitmap's bit depth; the archive metadata
  records `image: "bmp"`, `compression: "lzss"`, the dimensions and the declared `unpackedSize`.

Deviations, both tested: a declared size of zero is declined, and a size past 256 MiB is declined rather than
allocated, where the reference trusts the field. The reference gates on the `.PBM` extension, so the
descriptor registers no signature and the extension check lives in detection.

GARbro's `Write` throws `NotImplementedException`, so encoding and archive creation are out of scope.

## A process note

While adding this port I wrote the package's `index.ts` for `nekopunch/` with a plain redirect, on the
assumption that a new directory meant a new index — but this engine's archive port already existed and its
export was destroyed. The build caught it immediately (`TS2724` from the existing `nekopunch-pak` test), the
export was restored alongside the new one, and the diff was reviewed before committing. The rule recorded
earlier in this project — check `[ -f <dir>/index.ts ]` and **append**, never redirect — applies to the index
file even when the directory is known to exist for other reasons, and the check has to be made against the
file rather than the directory.
