# Game System TEXB texture

Reference: `GARbro/ArcFormats/GameSystem/ImageTEXB.cs`, class `TexbFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/gamesystem/texb-image.ts` (`texbImageDescriptor`, `texbImageFormat`,
id `gamesystem-texb-image`).

A raw 32 bit texture with an eight byte header and no signature:

| field | offset |
|---|---|
| width (`u32`) | 0 |
| height (`u32`) | 4 |
| BGRA pixels, bottom up | 8 |

The format is identified by **name and arithmetic only**: the reference requires the `.texb` extension, both
dimensions non-zero, and a file length of exactly `8 + width * height * 4`. A test shifts the file by one byte
in each direction and confirms both are declined. The extension check happens before any byte is read, as in
the reference, and is compared without regard to case.

The port exposes the resource as a single entry:

* `Read` uses `ImageData.CreateFlipped`, which means the stored rows run **bottom up**, and a bitmap records
  that with a **positive** height — the opposite of the other 32 bit ports in this repository, which use
  `ImageData.Create` and write a negative one. The test asserts the positive height, and also that the first
  stored row keeps its place at the front of the pixel data, so a port that quietly flipped the rows would
  fail;
* pixels are copied rather than reordered, and an odd width is used in the fixture so the absence of row
  padding is exercised rather than assumed: a 32 bit bitmap has no padding to add because every pixel is
  already four bytes;
* the entry is named after the source file with a `bmp` extension, covers the whole stored file, and sets
  `sizeKnown: false` because a bitmap header is written around the pixels;
* entry metadata carries `type: "image"`, width, height and `bitsPerPixel: 32`; the archive metadata records
  `image: "bmp"` and the dimensions.

GARbro's `Write` throws `NotImplementedException`, so encoding and archive creation are out of scope. The
descriptor advertises `texb`, matching the reference's own extension test.
