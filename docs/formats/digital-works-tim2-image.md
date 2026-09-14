# PlayStation/2 image (TIM2)

Reference: `GARbro/ArcFormats/DigitalWorks/ImageTM2.cs`, class `Tim2Format`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/digital-works/tim2-image.ts` (`digitalWorksTim2ImageDescriptor`,
`digitalWorksTim2ImageFormat`, id `digital-works-tim2-image`).

A texture behind the word `TIM2` with the extensions `tm2` and `ext`. The reference reads `0x40` bytes of header
and refuses the file outright for a depth code it does not know, so the word alone is **not** enough to find it:

| field | offset |
|---|---|
| depth code: 1 is 16 bits, 2 is 24, 3 is 32, 5 is 8 | 0x23 |
| width, height | 0x24, 0x26 |
| header size, counted from 0x10 | 0x1C |
| colour count | 0x1E |
| palette size, read but never used | 0x14 |

Everything else follows from the header size: the pixels begin at `0x10 + header size`, which for the reference's
own header of `0x30` is exactly `0x40`, and the **palette follows the pixels** rather than standing in front of
them. The body is a plain `width × height × depth / 8` bytes; there is no unpacker of any kind here.

The palette is read with the library's `RgbA` colour map — four bytes an entry, red, green, blue and **alpha** —
and a file that ends inside it fails the way the library's own `EndOfStreamException` does. It then goes through
two changes:

* the colours arrive in blocks of **eight** that are stored by block and by row and are wanted by row and by
  block, so a palette of four blocks comes out as the first, the third, the second and the fourth. The reference
  walks whole **parts** of thirty two colours only, so a palette that does not fill even one of them — sixteen
  colours, say — has **none** of its colours copied at all and is left as it was allocated, which is black here;
* each entry is written into the bitmap in blue, green, red, alpha order, with the alpha byte the file carried
  kept in the bitmap's fourth byte.

The pixels are turned around for the depths that need it: a body of **three or four bytes a pixel** stores red,
green, blue and alpha and the bitmap wants blue, green, red and alpha, so the first and the third byte of every
pixel change places. Eight and sixteen bit pixels are copied as they stand, the sixteen bit kind being the
bitmap's own five bits a channel as well.

The reference tests the **pixel size** rather than the depth when it decides whether to read a palette, which is
true for every depth that reaches that point, so a sixteen, twenty four or thirty two bit image that declares a
colour count reads a palette too — and fails when there is none. That is reproduced here.

Deviations from the reference, all for input it would fail on anyway:

* a zero width or height is refused here;
* an eight bit image that declares **no** colours is given a grey ramp, where the reference hands its image layer
  a null palette and cannot build a bitmap from it.

The tests cover the word, both extensions and the four known depth codes with the two unknown ones, the
measurements with the header's own sizes, the four block reorder of a thirty two colour palette, a sixteen colour
palette of which nothing survives, the grey ramp of a colourless eight bit image, the red and blue turn of a
thirty two and a twenty four bit pixel, a sixteen bit pixel copied as it stands, a body and a palette that do not
fit what the header declares, pixels taken from behind the header size, and the entry name.
