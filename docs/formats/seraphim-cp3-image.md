# Seraphim CP3X image

Reference: `GARbro/ArcFormats/Seraphim/ImageCP3.cs`, class `Cp3Format`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/seraphim/cp3-image.ts` (`cp3ImageDescriptor`,
`cp3ImageFormat`, id `seraphim-cp3-image`).

GARbro registers two classes for the same `CP3X` magic, with the **same tag and description**:

* `Cp3Opener` (`ArcCP3.cs`, ported earlier as `seraphim-cp3`) walks the multi-frame container at
  `0x2C` and lists every frame;
* `Cp3Format` (`ImageCP3.cs`, this port) presents the **first frame as a single image**, which is why
  its metadata sits at `0x34` and `0x38`: those offsets are the frame header's width and height
  (`0x2C + 8` and `0x2C + 12`), and the pixels start at `0x3C` (`0x2C + 0x10`).

Only the ids distinguish the two ports (`seraphim-cp3` versus `seraphim-cp3-image`); the shared tag is
faithful to the reference, and the catalog test enforces that the ids stay unique.

The port exposes the first frame as a single entry:

* detection needs the signature, dimensions above zero and a pixel area that fits inside the file (the
  reference reads the pixels unchecked and fails on a short read, so the bound is a documented
  deviation);
* width `u32@0x34`, height `u32@0x38`, four bytes per pixel, always 32 bit;
* extraction uses `writeBmp32(..., bottomUp)`: `Cp3Format.Read` calls `CreateFlipped`, i.e. the stored
  rows are **bottom up**, so the bitmap keeps a **positive height** and the pixels are copied verbatim.
  This is the only difference from the CGD, TBL and BPD ports, whose readers use the top-down
  `ImageData.Create` and therefore get a negative height;
* the entry is named after the source file with a `bmp` extension, `sizeKnown` is false because a
  bitmap header is prepended, and metadata carries `type: "image"` plus width, height and bit depth.

Pixel decoding and archive creation are out of scope.
