# MicroVision image (GTX)

A header that names one of two layouts, a second block holding the dimensions, and thirty two bit pixels behind
both of them. The reference calls the class `GpcFormat` and the stored marker `GPC0`, while its tag is `GTX`.

## Reference

| Element | Value |
| --- | --- |
| Tag | `GTX` |
| Class | `GpcFormat` (`ArcFormats/MicroVision/ImageGPC.cs`) |
| Signature | `0x30435047`, which reads back as the stored bytes `GPC0` |
| Extensions | None declared |

GARbro baseline `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License: an independent TypeScript rewrite based on
GARbro behavior.

## Header

The primary header is `0x40` bytes and holds the stored marker and a flags word:

| Offset | Size | Meaning |
| --- | --- | --- |
| `0x00` | 4 | `GPC0` |
| `0x0C` | 2 | Flags |

The flags choose between two variants, each of which follows the primary header with a block of its own:

| Flag | Block | Version word | Dimensions | Depth |
| --- | --- | --- | --- | --- |
| `0x1000` | `0x30` bytes | none | its own `0x10`, `0x12` | 32 |
| `0x2000` | `0x50` bytes | its own `0x14`, must be `1` | its own `0x10`, `0x12` | 32 |

Both blocks put the dimensions at the same offset within themselves, so a file's width and height are always at
`0x50` and `0x52` whichever variant it is. The first flag is looked for first, so a header carrying both is the
first variant.

Only the second variant has reading code in the reference: the first one's metadata is read and its pixels then
throw `NotImplementedException`. The port says the same thing in the same place — a file of the first variant is
detected, listed and described, and its extraction refuses rather than guessing a layout the reference never
wrote.

## Extraction

The pixels begin at `0x90`, behind both headers, four bytes a pixel and unflipped. The reference reads exactly
`width * 4 * height` bytes and fails when the file holds fewer, so the port refuses a truncated pixel block instead
of padding it, and hands the rest over to the shared bitmap writer.
