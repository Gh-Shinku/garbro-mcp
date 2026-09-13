# h.m.p MBP bitmap

Reference: `GARbro/Legacy/hmp/ImageMBP.cs`, class `MbpFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/hmp/mbp-image.ts` (`mbpImageDescriptor`, `mbpImageFormat`, id
`hmp-mbp-image`).

A **555 bitmap whose dimensions are checked against the file length**. The reference declares no signature
— its `Signature` property is `0` — and recognises a file purely by its extension plus arithmetic: the name
must end in `.MBP`, the header is eight bytes of width and height, and the file is accepted only when
`8 + width * height * 2` equals its exact length. Detection is therefore length gated, and the test tries a
file one byte short and one byte long, both of which must fail.

The port exposes the resource as a single entry:

* the extension check happens **before** any byte is read, as in the reference, and is compared without
  regard to case. It lives in `detect` and `read`, the two places that receive a source path;
* `ImageData.Create` with `PixelFormats.Bgr555` means rows are stored top down with two bytes per pixel.
  Extraction writes a bitmap through the new shared `writeBmp16` helper: a sixteen bit bitmap whose
  `biCompression` is `BI_BITFIELDS` (`3`) with the VGA 555 masks `0x7C00`, `0x03E0` and `0x001F` following
  the forty byte DIB header, so the pixel data starts at offset 66. That is how GARbro writes `Bgr555`
  data, and it preserves the stored pixels instead of widening them to 32 bits;
* rows are aligned to four bytes like every other bitmap in this repository, which for an odd width means
  two padding bytes. The test uses a three pixel wide image and asserts both the padding and that the
  second row starts after it;
* the entry is named after the source file with a `bmp` extension, covers the whole stored file, and sets
  `sizeKnown: false` because a bitmap header and its colour masks are written around the pixels;
* entry metadata carries `type: "image"`, width, height and `bitsPerPixel: 15` — the source is fifteen bit,
  while the bitmap that carries it is sixteen bit with colour masks. The archive metadata records
  `image: "bmp"`, the dimensions and `pixelFormat: "bgr555"`.

One deliberate deviation: a zero width or height would satisfy the length test for an eight byte file, so
that case is declined rather than reported as an empty image. It is tested.

The reference directory `Legacy/hmp/` also holds `ImageALP.cs`, whose port lives in
`packages/formats/src/bef/` because its tag is `ALP/BeF`; this format is named after the directory instead.

GARbro's `Write` throws `NotImplementedException`, so encoding and archive creation are out of scope.
