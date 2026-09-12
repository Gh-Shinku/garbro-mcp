# CRI SPC texture container

## Reference and attribution

- GARbro reference: `ArcFormats/Cri/ArcSPC.cs`, class `SpcOpener`
- GARbro tag: `SPC/CRI`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2016 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`SPC` files are detected by extension. A 32-bit unpacked size at offset 0 must be between 0x20 and
0x5000000, and the rest of the file is a default-variant LZSS stream that expands to that size.

The decompressed stream holds a nested index. Each index starts with a 32-bit first record offset
that is also the size of the record table and must be a multiple of 0x10. Records are 0x10 bytes:
a 32-bit offset relative to the index start, a 32-bit size, and eight unused bytes. A record is
either an `xtx` texture (`xtx\0` signature) or a nested index; nested indexes are named `0000`,
`0001`, ... and appear in listing order, matching GARbro's counter-based naming.

Extraction serves entry bytes from the decompressed index buffer, exactly like GARbro's
`StreamRegion` over the seekable LZSS stream.

## Support

| Capability | Status |
| --- | --- |
| Extension-based detection | Supported |
| LZSS index decompression | Supported |
| Nested `xtx` index walk | Supported |
| Generated entry names | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover a two-level index, generated names, entry extraction, and misaligned
nested indexes.
