# Cocktail Soft WMK bitmap mask

Reference: `GARbro/ArcFormats/FC01/ImageWMK.cs`, class `WmkFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/fc01/wmk-image.ts` (`wmkImageDescriptor`, `wmkImageFormat`, id
`fc01-wmk-image`).

A mask image with **no signature at all**: what identifies it is the relation between the dimensions
and the file length. The header is eight bytes — width `u32@0` and height `u32@4` — and the file must
be exactly `width * height + 0x10` bytes long. Two quirks follow from the reference:

* the pixels are read from offset **8**, so `width * height` bytes cover `[8, 8 + w*h)`, while the
  length check reserves `0x10`; the last **eight bytes** of the file are therefore not part of the
  image and are dropped;
* the pixels are `Gray8` and top down (`ImageData.Create`), one byte per pixel with no row padding.

The port exposes the resource as a single entry:

* detection is the length relation itself, since the registry has no signature to match on, plus
  non-zero dimensions. Declining a zero dimension is a deviation: the reference accepts a `0 x 0` mask
  for any file of exactly `0x10` bytes, which would make the format a candidate for unrelated files;
* the entry is named after the source file with a `bmp` extension, covers the pixel area from offset
  8, and sets `sizeKnown: false` because a bitmap header and palette are prepended;
* extraction writes an eight bit grey bitmap: the 54 byte header with a negative height, a full grey
  palette, and the pixels row by row padded to four byte boundaries (bitmap rows are aligned). The
  padding is the only difference from the stored pixels, exactly as for the TBL mask;
* entry metadata carries `type: "image"` plus width, height and bit depth, and the archive metadata
  records the same values with `image: "bmp"`.

Pixel decoding and archive creation are out of scope.
