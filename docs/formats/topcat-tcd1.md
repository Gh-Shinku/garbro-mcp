# TopCat TCD1 archive

## Reference and attribution

- GARBro reference: `ArcFormats/TopCat/ArcTCD1.cs`, class `Tcd1Opener`
- GARBro tag: `TCD1`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

A `TCD1` archive starts with the ASCII signature, a 32-bit record count at 4, the offset table
position at 8, and the name blob position at 12. The offset table holds `count + 1` 32-bit values:
GARbro reconstructs entry `i` by subtracting `index_offset << ((i & 7) + 8)` from its stored offset,
while the final offset, which closes the last entry, is stored plainly.

Names live in the trailing blob, one null-terminated CP932 name per record, and every non-zero name
byte is stored subtracted by 0x57. Entry sizes are the differences between consecutive offsets.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| Position-dependent offset correction | Supported |
| 0x57 name unmasking | Supported |
| Entry placement validation | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the offset correction, name unmasking, CP932 names, and offset table
bounds rejection.
