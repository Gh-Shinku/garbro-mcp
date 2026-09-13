# Acme ARD image

Reference: `GARbro/Legacy/Acme/ImageARD.cs`, class `ArdFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/acme/ard-image.ts` (`ardImageDescriptor`, `ardImageFormat`, id
`acme-ard-image`).

A **fixed size 32 bit image with no header at all**. Everything except the pixels is constant: the
reference gates on the `ARD` extension and an exact file length of `0x12C000`, then reports 640×480 at
32 bits per pixel. That length is exactly `640 * 480 * 4`, which the test asserts so the constants cannot
drift apart.

The pixels are stored with their channels **rotated**. The reference reads each four byte group as
`A B C D` and rewrites it as `B C D A` — a left rotation by one byte, which turns the stored order into
the `Bgra32` layout the image is built with. The test uses a group of four distinct bytes
(`11 22 33 44`), so a port that swapped the channels instead of rotating them would produce
`44 33 22 11` and fail, and it also compares the entire output against an independent rotation of the
input.

The port exposes the resource as a single entry:

* detection requires the `.ard` name (case insensitively) and the exact length. The name gate lives in
  `detect` and `read`, where the source path is available, while `openEntry` validates the length alone;
* the entry is named after the source file with a `bmp` extension, covers the whole stored file and sets
  `sizeKnown: false` because a bitmap header is prepended;
* extraction rotates the channels and writes a 32 bit bitmap with `writeBmp32`. The reference uses
  `ImageData.Create`, so the rows run top down and the bitmap carries a negative height;
* entry metadata carries `type: "image"` with the dimensions and bits per pixel, and the archive metadata
  records `image: "bmp"`, the dimensions, `bitsPerPixel: 32` and the `bgra32` pixel format.

Encoding and archive creation are out of scope.
