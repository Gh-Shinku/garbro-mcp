# Software House Parsley PCG image

Reference: `GARbro/ArcFormats/Software House Parsley/ImagePCG.cs`, class `PcgFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/parsley/pcg-image.ts` (`pcgImageDescriptor`, `pcgImageFormat`, id
`parsley-pcg-image`).

A **raw BGRA image** with a fixed header and an exact file length relation. The signature is `PCG0`
(`0x30474350`).

| field | offset |
|---|---|
| signature `PCG0` | 0 |
| unused | 4 |
| width (u32) | 12 |
| height (u32) | 16 |
| BGRA pixels, top down | 0x14 |

Nothing else is stored: the reference's metadata reader accepts the file only when its length is
**exactly** `width * height * 4 + 0x14`, which doubles as the pixel-data length. The port computes that
relation with `BigInt` so a hostile header cannot overflow it, and the tests check both directions — a file
one byte longer and one byte shorter than declared are both declined.

The port exposes the resource as a single entry:

* detection matches the signature and then applies the length relation. Zero dimensions are declined: the
  reference's relation would accept a twenty byte header-only file as a `0x0` image, which is not a usable
  bitmap. This is a deliberate deviation and is tested;
* the entry is named after the source file with a `bmp` extension, covers exactly the pixel data and sets
  `sizeKnown: false` because a bitmap header is prepended;
* extraction writes a 32 bit BGRA bitmap with `writeBmp32`. The reference uses `ImageData.Create`, so rows
  run **top down** and the bitmap carries a negative height; the pixel bytes, alpha included, are stored
  verbatim;
* entry metadata carries `type: "image"` with the dimensions and bits per pixel, and the archive metadata
  records `image: "bmp"`, the dimensions, `bitsPerPixel: 32` and the `bgra32` pixel format.

Encoding and archive creation are out of scope.
