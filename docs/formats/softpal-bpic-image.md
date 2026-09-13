# Softpal BPIC image

Reference: `GARbro/ArcFormats/Softpal/ImageBPIC.cs`, class `BpicFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/softpal/bpic-image.ts` (`bpicImageDescriptor`, `bpicImageFormat`, id
`softpal-bpic-image`).

A raw image whose colour channels are stored the other way round:

| field | offset |
|---|---|
| signature `BPIC` | 0 |
| width (`u32`) | 4 |
| height (`u32`) | 8 |
| bytes per pixel (`i32`), one of 1, 3 or 4 | 12 |
| pixels, packed rows | 0x10 |

`ReadMetaData` reads sixteen bytes and accepts the file when the word at twelve is **1, 3 or 4**; the depth is
eight bits to that byte, so 8, 24 or 32.

## The channel swap

`Read` reads exactly `width * height * pixelSize` bytes and then swaps, for every pixel, the third byte with the
first. The reference walks the buffer from index two with a step of a whole pixel, so it visits the third byte
of each pixel — 2, 5, 8 for three byte pixels and 2, 6, 10 for four byte ones — and swaps it with the byte two
before it. That converts the stored red, green, blue order into the blue, green, red order a bitmap holds, and
leaves a fourth byte, when there is one, exactly where it was. A test with two 32-bit pixels reads the result
back as `03 02 01 04 13 12 11 14` from `01 02 03 04 11 12 13 14`, so a port that swapped the wrong pair, or that
moved the alpha byte, would fail. Single byte pixels have nothing to swap and go straight to `writeBmp8`, whose
grey ramp a test samples.

## Notes

* The read must fill the buffer exactly: the reference compares the count it got with the size it asked for and
  throws when they differ, so a short file **lists** and fails at extraction. A test stores two of the four
  pixels the header asks for and pins that split.
* Trailing bytes are simply not read. A test appends nine bytes of junk to a two pixel image and expects the
  bitmap to carry only the swapped pixels and the row padding.
* The pixels are packed at the declared width, so a two pixel wide 24-bit image gets the bitmap's usual four
  byte row padding, which a test checks explicitly.
* The entry is named after the source file with a `bmp` extension, covers the whole stored file and keeps
  `sizeKnown: false`; metadata carries the dimensions and the depth, and the archive metadata matches. The
  reference declares no extensions and the port matches.
* A pixel size the reference does not list (0, 2, 5), a short header, a wrong signature and zero dimensions are
  all declined, the last as a documented deviation.
* The reference can write, by saving a bitmap and putting the tag back; detection, listing and extraction are
  what the port implements.
