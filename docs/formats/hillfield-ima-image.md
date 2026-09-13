# Hill Field script system image (IMA)

A thirty two bit image whose colour channels are stored as one planar block and whose alpha plane sits after that
block, at an offset the header declares rather than one the pixels imply.

## Reference

| Element | Value |
| --- | --- |
| Tag | `IMA` |
| Class | `ImaFormat` (`Legacy/HillField/ImageIMA.cs`) |
| Signature | None — a zero first word and two size relations are the whole probe |
| Header | `0x10` bytes |
| Extensions | None declared |

## Header

| Offset | Size | Meaning |
| --- | --- | --- |
| `0x00` | 4 | Must be zero |
| `0x04` | 4 | Size of the colour block, which must hold at least three bytes a pixel |
| `0x08` | 4 | Width |
| `0x0C` | 4 | Height |

## Layout and guards

The colour block starts at `0x10` and holds `width * height * 3` bytes — blue, green and red, one plane after
another. The alpha plane begins at **`8 + rgbSize`**, the header's eight byte prefix plus the declared block size,
so any padding the block declares is skipped rather than read as pixels. The alpha plane holds one byte a pixel and
is stored **inverted**, so a stored zero is fully opaque. The pixels are handed over flipped, which gives the
bitmap a positive height.

The probe accepts a file only when the pixel count is not zero, the colour block holds three bytes a pixel, and the
file has room for the alpha plane behind the declared block. It does **not** check that the colour block itself
fits: the reference reads it with `ReadBytes` and would fail there, and this port fails in the same place rather
than tightening the probe. The pixel count is the product of two unsigned words, so an image that is enormous
enough wraps to zero and is declined — a case the tests pin.

The decoded image is capped at 256 MiB on the port's own account.

## Process notes

The colour block's start and the alpha plane's origin are **different references** — `0x10` and `8 + rgbSize` — and
the fixtures have to model both, which is why the extraction test declares a block wider than its pixels: it fails
if the port ever derives the alpha offset from the pixel count instead.
