# EBG_SYSTEM bitmap archive

## Reference and attribution

- GARBro reference: `Legacy/EbgSystem/ArcBIN.cs`, class `BinOpener`
- GARBro tag: `BIN/EBG_SYSTEM`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

There is no index. The reference only opens files named `0000.bin` whose length is an exact multiple of the fixed bitmap
size of 0x96000 bytes; the record count is that quotient and must pass the usual sanity check. Every record is a plain
640×480 15-bit bitmap, numbered from zero with a four-digit index and a `.bmp` extension, and typed as an image.

The reference registers this opener inside a `#if DEBUG` block, so release builds of GARbro do not offer it. The layout
is unambiguous, so it is implemented here as listed and the limitation is recorded in the status file.

## Extraction

Bitmaps are emitted as their stored byte ranges. The reference hands them to an internal 640×480 15-bit image decoder
(`Bgr555`, flipped rows) instead of exposing them as archive entries, which is a GUI concern outside the archive layer.

## Support

| Capability | Status |
| --- | --- |
| `0000.bin` file name requirement | Supported |
| Fixed 0x96000 bitmap stride | Supported |
| Count derived from the file length | Supported |
| Numbered `.bmp` entry names | Supported |
| Image typing | Supported |
| Verbatim extraction | Supported |
| GUI image decoding | Unsupported |
| Debug-only registration in the reference | Noted |
| Archive creation | Unsupported |

Synthetic fixtures cover a two-record archive, image typing, the file name requirement, a length that is not a whole
number of bitmaps and an empty file.
