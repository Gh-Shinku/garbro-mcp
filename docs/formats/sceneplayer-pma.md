# ScenePlayer PMA animation resource

## Reference and attribution

- GARBro reference: `ArcFormats/ScenePlayer/ArcPMA.cs`, class `PmaOpener`
- GARBro tag: `PMA`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

A `.pma` file uses the same obfuscated zlib stream as the PMX variant: every byte is XORed with 0x21
and the first stored byte must be 0x59. The inflated stream starts with a 32-bit frame count and then
a chain of bitmaps, each introduced by one skipped byte, the `BM` marker, and the bitmap size. Frames
are named `<archive>#<n padded to 4>.bmp` and cover the decoded bytes from the marker to the declared
size.

## Support

| Capability | Status |
| --- | --- |
| Extension and XORed zlib header detection | Supported |
| XOR-0x21 and zlib decoding | Supported |
| Bitmap frame chain | Supported |
| `BM` marker validation | Supported |
| Generated frame names | Supported |
| Entry range validation | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the frame chain, generated names, marker rejection, and extension rejection.
