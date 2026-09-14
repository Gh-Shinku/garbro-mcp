# Leaf LGF image

Reference: `GARbro/ArcFormats/Leaf/ImageLGF.cs`, class `LgfFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/leaf/lgf-image.ts` (`lgfImageDescriptor`, `lgfImageFormat`, id
`leaf-lgf-image`).

| field | offset |
|---|---|
| `lfg` plus one of `0x18`, `0x20`, `0x09` | 0 |
| depth | 3 |
| width (`u16`) | 4 |
| height (`u16`) | 6 |
| four bytes the reference never reads | 8 |
| palette, four bytes an entry, only when the depth is eight | 12 |
| pixels, packed rows at `width * depth / 8` bytes | after the palette |

## The depth is the signature

`LgfFormat` declares `Signature = 0` and then a **list of three signatures** in its constructor:
`0x1866676C`, `0x2066676C` and `0x0966676C`. They differ in their fourth byte, which is the depth — 0x18 is 24,
0x20 is 32 and 0x09 is nine, which the metadata maps to **eight**. So the depth byte is not merely read, it is
part of what identifies the format, and a file whose fourth byte is eight is *not* recognised even though eight
is the depth nine maps to, while sixteen and four are not recognised either.

The port registers the three bytes the signatures share and re-checks the fourth itself, which is the fuller
rule and also keeps the registry gate honest. A test walks depths 8, 16, 4 and 0 and expects all four to be
declined; the first fixtures in this port's own tests had used a depth of eight for the eight bit images, which
the port rightly refused, and the disagreement between two of its own tests is what pointed at the mistake.

## The palette order, settled

`ReadPalette` is called with `PaletteFormat.RgbX`, and `GameRes/Image.cs` is worth reading alongside the format
itself: `ReadColorMap` converts only for `PaletteFormat.Bgr` and `PaletteFormat.BgrX`, which means the reader's
internal order is **red, green, blue** and `RgbX` data is already in it. A bitmap palette is stored the other way
round, so the port swaps the first and third byte of every entry — the same conversion, for the same reason, as
the Hypatia WBM reader, and this is the evidence that pins it. A test stores entry one as red 5, green 7, blue 11
and expects `[11, 7, 5, 0]` in the output.

A second test covers the same ground for the four byte layout making sure the unused fourth byte is carried
through, and the four bytes between the header and the palette are filled with a marker in a third to show they
reach nothing.

## Notes

* The depth decides the stride, and nine uses the stride of **eight**: `width * info.BPP / 8` with the mapped
  depth, not nine eighths of the width.
* `Read` compares the count it got with the size it asked for and throws when they differ, so a short payload
  **lists** and fails at extraction, which a test pins by storing four of the eighteen bytes a 3x2 24-bit image
  needs. The reference's probe needs only the eight byte header, which the same test asserts from the other side.
* Rows are packed at `width * depth / 8` bytes, so the bitmap's own four byte row padding is added by the writer
  and a 3-wide 24-bit test checks it.
* Extra bytes after the payload are ignored, and detection declines a file shorter than the header, a wrong
  prefix and zero dimensions — the last as a documented deviation.
* The entry is named after the source file with a `bmp` extension, covers the whole stored file and keeps
  `sizeKnown: false`. The reference declares no extensions and the port matches its `Write`, which throws.
