# Risa game platform image (SYG)

A plain twenty four bit image with an optional block of transparency behind it, and a header that promises a fourth
byte per pixel even when that block is not all there.

## Reference

| Element | Value |
| --- | --- |
| Tag | `SYG` |
| Class | `SygFormat` (`ArcFormats/Risa/ImageSYG.cs`) |
| Signature | `0x47595324`, which reads back as `$SYG` |
| Extensions | None declared |

GARbro baseline `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License: an independent TypeScript rewrite based on
GARbro behavior. The file lives under Risa while its namespace says WestVision, which the port keeps as a note only.

## Header

| Offset | Size | Meaning |
| --- | --- | --- |
| `0x00` | 4 | `$SYG` |
| `0x10` | 4 | Width |
| `0x14` | 4 | Height |
| `0x1C` | 4 | Distance from the colours to a block of transparency, or zero for none |

A non-zero word at `0x1C` is what makes the image thirty two bits, and the metadata reports it as such **before**
anything is read. Nothing else in the header is checked: a zero width or height describes an image this reader
cannot produce and the port refuses it, which is where the reference fails too.

## Pixels

Colours begin at `0x20` as ordinary blue, green, red triples with **no padding between the rows**, `width * height *
3` bytes in all. The reference reads exactly that many bytes and never looks at what the read returned, so a file
that stops early simply leaves the rest of the image black. The port keeps those bytes zero in the same way.

Transparency, when the header points at it, is one byte per pixel at `0x20 + alphaOffset`. The reference reads the
whole block and **only** interleaves it when the read filled it completely; a block that runs even one byte past the
end of the file leaves the bitmap at twenty four bits, while the metadata goes on saying thirty two. The tests pin
both halves of that, since the mismatch between them is the format's own behaviour and not a port choice.

No flip is applied, so the resulting bitmap is **top down** with a negative height.
