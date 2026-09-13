# KScript KSL grayscale image

Reference: `GARbro/ArcFormats/KScript/ImageKSL.cs`, class `KslFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/kscript/ksl-image.ts` (`kslImageDescriptor`, `kslImageFormat`, id
`kscript-ksl-image`).

An **eight bit gray image masked with a single byte key** that is itself derived from the header: the key is
the exclusive or of the bytes at offsets four and five, taken from the **stored** header before any
unmasking, and each pixel is then exclusive ored with it. A test drives this from both directions — it checks
that a payload stored under one key comes back as the intended image, and that a **different byte pair with
the same exclusive or** produces exactly the same output, so the field really is a key pair rather than a
fixed mask.

| field | offset |
|---|---|
| signature `KSLM` | 0 |
| key bytes (exclusive or gives the mask) | 4, 5 |
| data length (`i32`, signed) | 8 |
| width (`u32`) | 0xC |
| height (`u32`) | 0x10 |
| masked pixels | 0x14 |

The port exposes the resource as a single entry:

* `ReadMetaData` reads its twenty byte header and validates nothing else, so listing succeeds for a file whose
  payload is unusable and extraction is where the failure lands. Two tests cover that split: a declared length
  that runs past the end of the file, which in the reference is `ReadBytes` throwing rather than returning
  short data, and a **negative** signed length, which is rejected outright. This is one of the few places in
  this repository that does not clamp a short read;
* a payload longer than the image is accepted and the surplus is ignored, because the reference hands a
  `DataLength` sized buffer to `ImageData.Create` with the image's own stride; a payload *shorter* than the
  image is rejected, since the buffer could not describe the image it declares (a deviation, documented
  because the reference's behaviour there is not well defined);
* the entry is named after the source file with a `bmp` extension, covers the whole stored file, and is
  flagged `encrypted: true` with `sizeKnown: false` — the mask preserves the payload's length but a bitmap
  header is written around it;
* `ImageData.Create` keeps rows top down, so the bitmap takes a **negative** height; the output uses the
  shared `writeBmp8` with its gray palette, and a three pixel wide test image exercises the row padding;
* entry metadata carries `type: "image"`, the dimensions and `bitsPerPixel: 8`; the archive metadata records
  `image: "bmp"`, `encrypted: true` and the dimensions.

Deviations, both tested: zero width or height is declined, where the reference would build an empty image, and
a file shorter than the header is declined before any read. The signature `KSLM` is registered, and the port
declares no extensions because the reference gates on the signature alone.

GARbro's `Write` throws `NotImplementedException`, so encoding and archive creation are out of scope.
