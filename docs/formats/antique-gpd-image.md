# An*tique image (GPD)

A header of six words, an optional palette and pixels that are either stored as they are or run through the
library's own compressor. The Ankh engine has a `GpdFormat` of its own as well, with a different marker, in
`ArcFormats/Ankh/ImageGPD.cs`.

## Reference

| Element | Value |
| --- | --- |
| Tag | `GPD` |
| Class | `GpdFormat` (`ArcFormats/Antique/ImageGPD.cs`) |
| Signature | `GPD ` |
| Extensions | None declared |

GARbro baseline `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License: an independent TypeScript rewrite based on
GARbro behavior.

## Header

| Offset | Size | Meaning |
| --- | --- | --- |
| `0x00` | 4 | `GPD ` |
| `0x08` | 4 | Width |
| `0x0C` | 4 | Height |
| `0x10` | 4 | Palette entries, signed |
| `0x14` | 4 | Depth, signed |

Not one of these fields is checked where the reference reads it: the probe is the marker and a file long enough to
hold the header, and a depth of `16` describes an image whose pixels can never be read. The port keeps that
arrangement — the refusal sits where the reference's own sits, in the reading code — so that a listing describes
what the header says and an extraction is where a header that lies is found out.

## Palette

An eight bit image carries its palette at `0x18` before the pixels: four bytes an entry, blue first, which is the
reference's own `PaletteFormat.BgrX` default. The count is the header's field **as it stands**, with no default of
its own, so a header that says zero entries yields an empty palette rather than a full one. The shared bitmap
writer lays down a whole `1024` byte palette page with those entries at its front.

## Pixels

The word behind the palette decides how the pixels are stored:

| Value | Meaning |
| --- | --- |
| `-1` | The pixels follow as they are |
| Anything else | The rest is a default `LzssStream` stream |

A row takes `width * depth / 8` bytes, multiplied before it is divided, which for twenty four bits is three bytes
a pixel exactly. A short uncompressed block leaves the rest of the pixels blank, because the reference reads what
it asks for and looks at the count it got back only never. The reference hands the image over **flipped**, so the
bitmap's height is positive and its rows are bottom up.
