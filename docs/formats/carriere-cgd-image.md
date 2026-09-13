# Carriere CGD image

Reference: `GARbro/ArcFormats/Carriere/ImageCGD.cs`, class `CgdFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/carriere/cgd-image.ts` (`cgdImageDescriptor`, `cgdImageFormat`,
id `carriere-cgd-image`).

A standalone image resource and about the simplest shape there is: the signature is `cgd` plus a zero
fourth byte (`0x00646763` as a little endian word), the header is `0x14` bytes and only holds the
dimensions — width at `0x0C` and height at `0x10`, both `u32`. The pixels start at `0x14`, are always
four bytes per pixel, and the reference reports them as `Bgra32` through `ImageData.Create`, i.e.
**top down** (no flipping).

The port exposes the resource as a single entry:

* detection needs the signature, dimensions above zero and a pixel area that fits inside the file (the
  reference reads the pixels unchecked and fails on a short read, so the bound is a documented
  deviation);
* the entry is named after the source file with a `bmp` extension and covers exactly the pixel area;
* `sizeKnown` is false because a bitmap header is prepended, so the payload is longer than the stored
  pixels;
* extraction writes a 54 byte bitmap (`BITMAPFILEHEADER` plus `BITMAPINFOHEADER`, 32 bits per pixel,
  no compression) and appends the pixels **byte for byte**. Because the source is top down, the bitmap
  height is written as a *negative* value, which is how the format records a top-down image; had the
  pixels been flipped, the round trip would not be byte-exact;
* entry metadata carries `type: "image"` plus width, height and bit depth, and the archive metadata
  records the same values with `image: "bmp"`.

Pixel decoding and archive creation are out of scope.
