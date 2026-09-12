# Active Soft ADPACK32

## Reference and attribution

- GARbro reference: `ArcFormats/ActiveSoft/ArcADPACK.cs`, class `Pak32Opener`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on the observed structure and GARbro
behavior.

## Structure

An ADPACK32 archive starts with the ASCII signature `ADPACK32`. A little-endian 32-bit value at
offset `0x0c` gives the number of index records. The final record is a sentinel, so the number of
files is one less than this value.

Each `0x20`-byte index record contains a null-terminated, `0x18`-byte CP932 filename and a
little-endian 32-bit data offset at `0x1c`. An entry extends from its own offset to the offset in the
next record. Data is stored without compression or encryption.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| CP932 filenames | Supported |
| Entry listing | Supported |
| Single and complete extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover CP932 names, boundary-derived sizes, extraction, and malformed sentinel
offsets. Real-game differential validation is still required before the format is marked verified.
