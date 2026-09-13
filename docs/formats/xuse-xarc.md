# Xuse XARC archive

## Reference and attribution

- GARBro reference: `ArcFormats/Xuse/ArcXARC.cs`, class `XarcOpener`
- GARBro tag: `XARC/XUSE`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

An `XARC` archive stores a 32-bit record count at 4 and a table of 32-bit record offsets at 8. GARbro
requires the first offset to equal `count * 4 + 10`, which places the data area two bytes behind the
end of the offset table.

Each record starts with a `DATA` marker and holds the encrypted name length at +0x18, the size at
+0x1c, and the name at +0x20. Name bytes are stored rotated left by four bits, which is the same
nibble swap as a four-bit rotation to the right, and the payload starts after the name plus a
two-byte gap. The stored extension of the descriptor is `arc`.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| First-offset validation | Supported |
| `DATA` record markers | Supported |
| Nibble-rotated names | Supported |
| Entry placement validation | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Entry type inference | Unsupported |
| Archive creation | Unsupported |

Entry type inference needs GARbro's global signature catalog, which also covers image and audio
decoders that this toolkit does not implement.

Synthetic fixtures cover the offset table, nibble-rotated names, and record validation.
