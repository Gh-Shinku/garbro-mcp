# Liddell FLK archive

## Reference and attribution

- GARBro reference: `Legacy/Liddell/ArcFLK.cs`, class `FlkOpener`
- GARBro tag: `FLK`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`FLK` files are detected by extension and use a chain of 0x10-byte descriptors. Bytes 0, 1 and
3 pack the next payload offset in units of 0x10, while byte 3 of the first descriptor supplies
the archive base offset (`byte << 8`). Byte 2 carries a tail size that adds `tailSize - 0x10`
bytes to the entry size when non-zero, and bytes 4..0x0f hold a null-terminated CP932 name.
The chain ends at the first descriptor whose name starts with a zero byte.

## Support

| Capability | Status |
| --- | --- |
| Extension-based detection | Supported |
| Bit-packed descriptor chain | Supported |
| Tail-size adjustment | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
