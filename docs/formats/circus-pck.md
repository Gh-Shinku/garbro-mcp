# Circus PCK archive

## Reference and attribution

- GARBro reference: `ArcFormats/Circus/ArcPCK.cs`, class `PckOpener`
- GARBro tag: `PCK/CIRCUS`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`PCK` archives start with a 32-bit entry count and a 32-bit data offset that must not point
back into the index. The index follows an eight-byte-per-entry preamble at `4 + count * 8` and
uses 0x40-byte records with a 0x38-byte CP932 filename, a 32-bit offset at +0x38, and a 32-bit
size at +0x3c. GARbro additionally requires the first record offset to equal `4 + count * 0x48`.

## Support

| Capability | Status |
| --- | --- |
| Structural detection | Supported |
| Index-boundary validation | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
