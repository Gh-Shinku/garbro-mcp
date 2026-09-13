# Project-μ KGR obfuscated bitmap

Reference: `GARbro/Legacy/ProjectMyu/ImageKGR.cs`, class `KgrFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/project-myu/kgr-image.ts` (`kgrImageDescriptor`, `kgrImageFormat`, id
`project-myu-kgr-image`).

Despite the description, the file keeps its `BM` marker in place: what makes it non standard is that the
reference only reads the fields it needs, at the offsets a bitmap keeps them, and ignores the rest.

| field | offset |
|---|---|
| marker `BM` | 0 |
| `bfSize`, **never read** | 2 |
| `bfOffBits`, **never read** | 0xA |
| width (`u32`) | 0x12 |
| height (`u32`) | 0x16 |
| bit depth (`u16`, 16 or 24) | 0x1C |
| pixels (packed rows, `width * depth / 8` bytes each) | 0x36 |

`ReadMetaData` gates on the `.kgr` extension, compares the first two bytes with `BM`, reads the depth and the
dimensions, and stops. It never looks at `bfSize` or `bfOffBits`, and `Read` takes the pixels from offset
`0x36` rather than from the offset field — a test writes `0xdeadbeef` and `0x11223344` into those two words and
asserts that the image still decodes, so the fields are provably inert here.

The port exposes the resource as a single entry:

* the depth is one of the two the reference accepts (16 or 24); anything else, including the 8 and 32 bit
  depths other bitmap readers in this repository take, is declined;
* a **sixteen bit image is BGR565** — `PixelFormats.Bgr565` — with six green bits, not the five the MBP, GR1
  and CBF ports use. `writeBmp16` in `shared/bmp.ts` hardcoded the five bit masks, so it now takes an optional
  mask triple with the previous value as its default; that change is its own commit (`refactor(shared):
  parameterise the 16 bit bitmap colour masks`) and the three existing ports' tests pass unchanged. A test here
  asserts the mask words at offsets 54, 58 and 62 are `0xF800`, `0x07E0` and `0x001F`, which a five bit writer
  could not produce;
* the stored rows are **packed** at `width * depth / 8` with no row alignment; the bitmaps written here use the
  aligned stride, and a three pixel wide test image exercises the difference, checking both the data and the
  zero padding of each row;
* extraction fails on a short file rather than zero filling, because the reference's `ReadBytes` throws. A test
  truncates a file by three bytes and asserts that it still lists but cannot be extracted;
* `ImageData.CreateFlipped` stores rows bottom up, so the bitmaps take a positive height;
* the entry is named after the source file with a `bmp` extension, covers the whole stored file and keeps
  `sizeKnown: false`; entry metadata carries `type: "image"`, the dimensions and the depth, and the archive
  metadata records `image: "bmp"`, the dimensions, the depth and the computed `bytesPerRow`;
* the reference declares no signature and gates on the `.kgr` extension, so detection keeps the extension check
  and a short header, a wrong marker and zero dimensions are all declined. The zero dimension case is a
  deviation, since the reference would build an empty image, as is a pixel buffer past 256 MiB.

GARbro's `Write` throws `NotImplementedException`, so encoding and archive creation are out of scope.

## One fixture correction

The test that exercises the ignored size fields compared the whole bitmap body against a packed buffer, but the
body is row aligned — for a two pixel wide image that is eight bytes a row against six stored, so the lengths
differed by four. The assertion now checks each row's data and padding separately, which is what the padded
writer actually produces.
