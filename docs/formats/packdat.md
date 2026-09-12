# SYSTEM-epsilon PACKDAT

## Reference and attribution

- GARBro reference: `ArcFormats/ArcPACKDAT.cs`, class `PakOpener`
- GARBro tag: `PACKDAT`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015-2016 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The archive begins with `PACKDAT.`, a little-endian entry count, and 0x30-byte index records. Each
record contains a 0x20-byte CP932 filename, absolute offset, flags, stored size, and a declared
unpacked size.

The `0x10000` flag applies a rotating 32-bit XOR to complete dwords. Its key is derived from the
stored length and rotated after every word according to the decoded value. Entries ending in `.s`
then invert every byte. These are equal-length transforms; the declared unpacked size does not
trigger decompression in GARbro.

## Support

| Capability | Status |
| --- | --- |
| Signature and structural detection | Supported |
| CP932 filenames | Supported |
| Raw entry extraction | Supported |
| Rotating-XOR entry decoding | Supported |
| `.s` byte inversion | Supported |
| Combined transforms | Supported |
| Archive creation | Unsupported |

The implementation is covered by synthetic fixtures generated through the inverse transformations,
including non-dword tails and combined flags. No real game data is used, following the current
migration policy.
