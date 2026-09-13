# KeroQ bitmap (CBM)

An eight bit image whose colours live in a palette file beside it, and whose header ties itself to the file's exact
length.

## Reference

| Element | Value |
| --- | --- |
| Tag | `CBM` |
| Class | `CbmFormat` (`Legacy/KeroQ/ImageCBM.cs`) |
| Signature | `0x004D4243`, which reads back as `CBM` and a null |
| Extensions | None declared |

GARbro baseline `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License: an independent TypeScript rewrite based on
GARbro behavior.

## Header

| Offset | Size | Meaning |
| --- | --- | --- |
| `0x00` | 4 | `CBM` and a null |
| `0x04` | 4 | Width |
| `0x08` | 4 | Height |
| `0x0C` | 4 | How many bytes follow the header |

The length word is **checked**: the reader refuses the file unless that word is exactly the number of bytes behind
the header. A file with one byte too many or too few is not this format at all, which is what keeps the marker from
being enough on its own. The entry's size is therefore exact rather than derived.

## Pixels and the palette

Pixels are one byte each, `width * height` of them, starting at `0x10` with no padding between the rows. The
reference reads exactly that many bytes, so a file that ends inside the pixels fails here as it does there — a
stricter outcome than the Risa reader, which zero fills a short colour block.

The byte is a grey level unless a palette file is found. GARbro looks for four names beside the image, and it
rewrites its own base name as it goes, so the last two candidates are built from the **shortened** name rather than
the whole one:

| Order | Name for `CG_01.cbm` | Note |
| --- | --- | --- |
| 1 | `CG_01.pal` | The whole base name |
| 2 | `CG_.pal` | The first three characters, only when the name is longer than three |
| 3 | `CG__2.pal` | Built from the shortened name, not from `CG_01` |
| 4 | `CG__1.pal` | Likewise |

The port reproduces that exactly, since a game that shipped a palette under one of those names would otherwise lose
its colours. The reader stops at the **first** candidate that exists, whether or not it reads well: a palette file
that is not a full page of entries is swallowed and the image stays grey, with no attempt at the next name.

A palette file holds a full page of blue, green, red triples. The port expands them into the four byte entries a
bitmap palette page carries, leaving the unused byte clear, and hands an image without any palette the same grey
ramp a grey bitmap would have.

No flip is applied, so the resulting bitmap is **top down** with a negative height.
