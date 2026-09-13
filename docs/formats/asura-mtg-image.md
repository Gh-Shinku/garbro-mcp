# Asura engine image (MTG)

A thirty two bit header, a block of colour pixels and, optionally, an alpha plane behind it. The format has no
signature at all: its extension is what identifies it.

## Reference

| Element | Value |
| --- | --- |
| Tag | `MTG` |
| Class | `MtgFormat` (`Legacy/Asura/ImageMTG.cs`) |
| Signature | None — `ReadMetaData` requires a `.mtg` name and nothing else |
| Header | `0x10` bytes |
| Extensions | `.mtg` |

## Header

| Offset | Size | Meaning |
| --- | --- | --- |
| `0x00` | 4 | Width |
| `0x04` | 4 | Height |
| `0x08` | 4 | Length of the pixel block, signed, positive and never longer than the file |
| `0x0C` | 4 | Whether an alpha plane follows: zero or one, anything else is declined |

## Decoding

The pixel block starts at `0x10` and is followed immediately by the alpha plane, which holds one byte a pixel. The
colour bytes are three a pixel. Without an alpha plane the image is handed over as `Bgr24` **top down**; with one
it becomes `Bgra32`, still top down. The metadata reports twenty four bits either way, which is what the reference
does — the real depth is the pixel format's.

The alpha plane follows the pixel block's declared **length**, not the three bytes a pixel that block holds, so a
block that declares padding has its alpha plane read after the padding. The tests pin that with a sixteen byte
block holding twelve bytes of pixels.

A block that is shorter than three bytes a pixel cannot fill the image. The reference's probe accepts such a file
and the read then fails on the array bound this port checks itself, which is why the read, not the probe, is where
the failure belongs.

## Not ported

`MtgFormat.Write` throws in the reference, so nothing is emitted here either.
