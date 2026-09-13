# Hill Field IMG image

Reference: `GARbro/Legacy/HillField/ImageIMG.cs`, class `ImgFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/hillfield/img-image.ts` (`hillFieldImgImageDescriptor`,
`hillFieldImgImageFormat`, id `hillfield-img-image`).

An **uncompressed 24 bit BGR image**:

| field | offset |
|---|---|
| width (`u32`) | 0 |
| height (`u32`) | 4 |
| BGR pixels | 8 |

The size check is on the **length**, not on an offset, and it accepts two answers: three bytes per pixel must
account for either the whole file minus ten bytes or the whole file minus eight. Because the pixels begin at
offset eight, those two cases are exactly "no trailing bytes" and "two trailing bytes", so the port accepts
slack of zero or two bytes and rejects anything else — a test checks both accepted lengths and the two
neighbouring ones. A second test confirms that the slack is ignored during extraction rather than copied.

The reference gates on the `.IMG` extension before reading anything, so the descriptor registers no
signature and the extension check lives in detection. Extraction reads the fields without repeating the gate,
matching the other extension-gated ports.

The port exposes the resource as a single entry:

* the pixels are copied unchanged and wrapped by the new `writeBmp24` helper in `shared/bmp.ts`. A 24 bit
  bitmap stores rows in BGR order, which is also the source order here, so no channel swapping happens; the
  only change is that rows are aligned to four bytes, and a test uses a three pixel row to exercise the
  three bytes of padding;
* `Read` uses `ImageData.CreateFlipped`, so rows are stored **bottom up** and the bitmap takes a **positive**
  height — the same shape as the GR1, MSK and CBF ports;
* the entry is named after the source file with a `bmp` extension, covers the whole stored file and keeps
  `sizeKnown: false` because a bitmap header is written around the copied pixels;
* entry metadata carries `type: "image"`, width, height and `bitsPerPixel: 24`; the archive metadata records
  `image: "bmp"` and the dimensions.

Deviations, both tested: a zero width or height is declined, where the reference would accept an eight or ten
byte file as a zero sized image, and a file shorter than the header is declined before any read.

GARbro's `Write` throws `NotImplementedException`, so encoding and archive creation are out of scope.
