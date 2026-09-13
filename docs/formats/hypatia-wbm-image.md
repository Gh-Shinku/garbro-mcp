# Hypatia WBM bitmap

Reference: `GARbro/ArcFormats/Hypatia/ImageWBM.cs`, class `WbmFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/hypatia/wbm-image.ts` (`wbmImageDescriptor`, `wbmImageFormat`, id
`hypatia-wbm-image`).

An eight bit image with a fixed header and a **palette that lives in a companion file**:

| field | offset |
|---|---|
| signature `!WBM` | 0 |
| width (`u16`) | 4 |
| height (`u16`) | 6 |
| unused | 8 |
| pixels, one byte each, packed rows | 12 |

`ReadMetaData` reads the twelve byte header and takes only the dimensions from it — the depth is always eight
and the four bytes at offset eight are never read, so detection needs nothing but the signature and a header's
worth of bytes. The palette is resolved during extraction: GARbro looks for a file called `data.act` beside the
image (through its virtual filesystem, which is the same directory in practice) and, if it exists, reads 256
RGB triples from it and switches the image from grey to indexed. The port uses the shared `readCompanionFile`
helper, which is how the sibling-file ports already resolve such names.

This repository has dealt with the RGB-versus-BGRX question before. `ReadPalette` with `PaletteFormat.Rgb`
yields red, green, blue triples while a bitmap palette holds blue, green, red, unused entries, so the port
swaps the channels before handing the table to `writeBmp8Palette`, which copies its input verbatim — the same
distinction the System98 `writeBmp4` path and the FRM reader document from opposite sides. A test reads entry
one out of the output and expects `[11, 7, 5, 0]` for a stored `(5, 7, 11)`, then checks the last entry as
well, so a port that copied the table unswapped would fail.

The port exposes the resource as a single entry:

* with no companion file the pixels are wrapped by `writeBmp8`, whose grey ramp a test samples at four indices;
* with one, they are wrapped by `writeBmp8Palette` using the converted table;
* a companion that exists but cannot supply 256 entries is treated as an error rather than silently falling back
  to grey, which is where the reference's `ReadPalette` throws. Detection and listing do not touch the
  companion at all, so such a file still lists and only extraction fails — a test pins that split;
* extraction fails on a short file rather than padding, because the reference's `ReadBytes` throws; a test
  truncates the pixels by two bytes and asserts the same split;
* data past the image is ignored, and `ImageData.Create` keeps rows **top down**, so the bitmap takes a
  negative height; the stored rows are packed at the image width and a three pixel wide test image exercises
  the bitmap's row padding;
* the entry is named after the source file with a `bmp` extension, covers the whole stored file and keeps
  `sizeKnown: false`; entry metadata carries `type: "image"`, the dimensions, the depth and whether the palette
  came from `data.act` or the grey ramp, and the archive metadata matches;
* the signature is registered and both of the reference's extensions (`wbm` and `dat`) are declared. Zero
  dimensions and a short header are declined, the first as a documented deviation.

GARbro's `Write` throws `NotImplementedException`, so encoding and archive creation are out of scope.

## A hard rule about index files, learned twice

This port's directory already existed — it holds the Hypack, Mariel and LPK readers — and its `index.ts` was
nevertheless overwritten with a redirect while adding the new export, destroying three exports. The build caught
it immediately (`TS2724` from two existing tests) and the file was restored from `HEAD` with the new export
appended. The rule is not "check whether the directory is new" and not "check whether an index exists": the only
safe sequence is to read the current index file, then **append**, and to verify with `git diff` before
committing. The same mistake was made once before in this project, in the `nekopunch` directory.
