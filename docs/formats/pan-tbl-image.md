# Pan engine TBL bitmap mask

Reference: `GARbro/Legacy/Pan/ImageTBL.cs`, class `TblFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/pan/tbl-image.ts` (`tblImageDescriptor`, `tblImageFormat`, id
`pan-tbl-image`).

A standalone image resource: a bitmap mask. The signature is `tbl` plus a zero fourth byte
(`0x006C6274` as a little endian word), the header is `0x14` bytes and holds only the dimensions
(width `u32@0x0C`, height `u32@0x10`). The pixels start at `0x14`, are **one byte per pixel** and the
reference reports them as `Gray8` through `ImageData.Create`, i.e. **top down** (no flipping).

The port exposes the resource as a single entry:

* detection needs the signature, dimensions above zero and a pixel area that fits inside the file (the
  reference reads the pixels unchecked and fails on a short read, so the bound is a documented
  deviation);
* the entry is named after the source file with a `bmp` extension and covers exactly the pixel area;
* `sizeKnown` is false because a bitmap header and palette are prepended;
* extraction writes an eight bit bitmap: the 54 byte header (negative height for top-down order,
  `clrUsed` set to 256), a **full grey palette** (entry *i* is `i, i, i, 0`) and then the pixels row
  by row. Because eight bit bitmap rows are aligned to four byte boundaries, every row is padded to
  `width` rounded up to a multiple of four; the padding bytes are zero and are the only difference
  from the stored pixels;
* entry metadata carries `type: "image"` plus width, height and bit depth, and the archive metadata
  records the same values with `image: "bmp"`.

Pixel decoding and archive creation are out of scope.
