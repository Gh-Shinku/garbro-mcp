# PineSoft BPD image

Reference: `GARbro/Legacy/PineSoft/ImageBPD.cs`, class `BpdFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/pinesoft/bpd-image.ts` (`bpdImageDescriptor`,
`bpdImageFormat`, id `pinesoft-bpd-image`).

A standalone image resource: the signature is `BPD` plus a zero fourth byte (`0x00445042` as a little
endian word), the header is only **eight** bytes long and the dimensions are **sixteen bit words** —
width at `0x04`, height at `0x06`. The pixels start at `0x08`, are always four bytes per pixel, and
the reference reports them as `Bgra32` through `ImageData.Create`, i.e. **top down** (no flipping).

The port exposes the resource as a single entry:

* detection needs the signature, dimensions above zero and a pixel area that fits inside the file (the
  reference reads the pixels unchecked and fails on a short read, so the bound is a documented
  deviation);
* the entry is named after the source file with a `bmp` extension and covers exactly the pixel area;
* `sizeKnown` is false because a bitmap header is prepended, so the payload is longer than the stored
  pixels;
* extraction writes the same 54 byte bitmap the CGD port writes — 32 bits per pixel, no compression,
  and a **negative height** so the top-down byte order survives the round trip;
* entry metadata carries `type: "image"` plus width, height and bit depth, and the archive metadata
  records the same values with `image: "bmp"`.

Pixel decoding and archive creation are out of scope.

## Follow-up

The bitmap writer in this file was the third copy of the same 32 bit header layout (CGD, TBL and BPD).
It has since been extracted into `packages/formats/src/shared/bmp.ts` (`writeBmp32` and `writeBmp8`) by
the `refactor(shared): extract shared bitmap writers` commit, which changed the three formats without
changing behaviour; their tests, which assert the bitmap bytes field by field, verified that.
