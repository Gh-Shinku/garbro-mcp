# Cvns engine grayscale image

Reference: `GARbro/ArcFormats/Cmvs/ImageMSK.cs`, class `MskFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/cmvs/msk-image.ts` (`mskImageDescriptor`, `mskImageFormat`, id
`cmvs-msk-image`).

A grayscale image — the description in the reference says "Cvns engine", a typo for CMVS that is kept
verbatim. The signature is `MSK0` (`0x304B534D`), the header is `0x10` bytes and holds only the
dimensions (width `u32@0x08`, height `u32@0x0C`); the reference also registers the `msk` extension. One
byte per pixel starts at `0x10` and the reference reports it as `Gray8` through `ImageData.Create`, i.e.
top down with no row padding in the stored data.

The port exposes the resource as a single entry:

* detection needs the signature, non-zero dimensions and a pixel area that fits inside the file. The
  bound and the zero-dimension check are documented deviations: the reference reads the pixels unchecked
  and fails on a short read;
* the entry is named after the source file with a `bmp` extension, covers exactly the pixel area — a
  trailing region the header does not account for is ignored, which a test pins down — and sets
  `sizeKnown: false` because a bitmap header and palette are prepended;
* extraction writes an eight bit grey bitmap through the shared `writeBmp8` helper: 54 byte header with
  a negative height, a full identity grey palette, and the pixels row by row padded to four byte
  boundaries. The padding is the only difference from the stored pixels, as in the TBL, WMK and other
  mask ports;
* entry metadata carries `type: "image"` plus width, height and bit depth, and the archive metadata
  records the same values with `image: "bmp"`.

Pixel decoding and archive creation are out of scope.
