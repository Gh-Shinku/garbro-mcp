# UM Utility UMPK audio archive

## Reference and attribution

- GARBro reference: `ArcFormats/StudioJikkenshitsu/ArcUMPK.cs`, class `PakOpener`
- GARBro tag: `PAC/UMPK`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

A `UMPK` archive starts with the signature and the version marker `0001` at 4. A byte at 0x18 sizes
the header name that follows at 0x1a, and the record area begins behind it. The record area holds a
reserved word that must be zero, a 32-bit record count at +8, and variable-length records from +12:
the record length, the stored size, the data offset, an id, the name length, and the name. GARbro
advances by `record_length + 4` bytes per record.

Data offsets are relative to the end of the file header plus eight bytes. Every payload is XORed with
a key derived from the name, the size, and the id: GARbro sums the UTF-16 code units of the name,
folds that together with the size, the id, and three byte-shifted copies of the sum into one byte,
and substitutes 0x37 when the result is zero.

## Support

| Capability | Status |
| --- | --- |
| Signature and version detection | Supported |
| Variable-length header name | Supported |
| Reserved word validation | Supported |
| Variable-length records | Supported |
| Derived per-entry XOR keys | Supported |
| Zero-key fallback (0x37) | Supported |
| Entry placement validation | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the record walk, derived keys, the fallback path, and reserved word
rejection.
