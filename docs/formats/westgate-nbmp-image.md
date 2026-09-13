# West Gate NBMP bitmap

Reference: `GARbro/Legacy/WestGate/ImageNBMP.cs`, class `NbmpFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/westgate/nbmp-image.ts` (`nbmpImageDescriptor`, `nbmpImageFormat`, id
`westgate-nbmp-image`).

An **uncompressed bitmap** in the format's own header:

| field | offset |
|---|---|
| signature `NBMP` | 0 |
| fixed header word `0x28` | 4 |
| width (`u32`) | 8 |
| height (`u32`) | 0xC |
| bit depth (`i16`) | 0x12 |
| palette (eight bit images only, 256 BGRX entries) | 0x2C |
| pixels | 0x2C, or after the palette |

`ReadMetaData` checks the signature, the word at offset four and the bit depth — which must be 8, 24 or 32 —
and reads the dimensions, but validates nothing about the payload. The port keeps that split: a file whose
pixels are missing still lists, and extraction is where the failure lands, because the reference's `ReadBytes`
throws rather than returning short data. A test truncates a file by four bytes and asserts both halves.

The port exposes the resource as a single entry:

* the reference computes `stride = (width * depth / 8 + 3) & ~3` and reads `stride * height` bytes. That stride
  is **by construction the stride a bitmap uses at the same depth**, so the stored rows are already in the
  output layout — including any bytes past the last pixel of a row, which are part of the stored image and
  which the reference carries into the `ImageData` untouched;
* the first version of this port passed the pixels to `writeBmp24` and `writeBmp8Palette`, which treat their
  input as **packed** and pad each row with zeros. Two tests caught it: both compared the output body with the
  stored bytes and failed only in the padding, one showing `…, 55, 0, 78, …` where the file has `…, 55, 78, …`.
  The port now writes the header itself and appends the stored palette and pixels verbatim, which is the same
  shape as `writeBmp32` and reproduces the reference exactly. This is the first port where the stored padding
  is observable, and it is why `writeHeader` is now exported from `shared/bmp.ts`;
* a 32 bit image is stored as BGRX, and `writeBmp32` passes all four bytes through; a test fills every fourth
  byte with `0x11` and asserts that the marker survives;
* for eight bit images the stored palette is read with the reference's default, a full 256 entry BGRX table,
  which is already the order a bitmap palette uses, so it is copied as it stands rather than converted — unlike
  the `writeBmp4` path used by the System98 port. The palette itself is asserted byte for byte;
* `ImageData.CreateFlipped` stores rows bottom up, so the bitmaps take a positive height;
* the entry is named after the source file with a `bmp` extension, covers the whole stored file and keeps
  `sizeKnown: false`; entry metadata carries `type: "image"`, the dimensions, the bit depth and the computed
  `stride`, and the archive metadata records `image: "bmp"` and the dimensions.

Deviations, all tested: zero width or height is declined, where the reference would build an empty image; a
file shorter than the header is declined before any read; and a wrong word at offset four, a bit depth outside
the three supported values and a different signature are each declined.

GARbro's `Write` throws `NotImplementedException`, so encoding and archive creation are out of scope.
