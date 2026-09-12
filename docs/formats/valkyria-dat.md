# Valkyria DAT archive

## Reference and attribution

- GARBro reference: `ArcFormats/Valkyria/ArcDAT.cs`, class `DatOpener`
- GARBro tag: `DAT/VALKYRIA`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2016 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`DAT` archives have no magic signature. A 32-bit index size at offset 0 must be a non-zero
multiple of the 0x10c record size and must be smaller than the file. The index begins at 4 and each
record holds a null-terminated CP932 filename (0x104 bytes) plus a 32-bit offset and 32-bit size.
Entry payloads start after the index at `4 + indexSize`; stored offsets are relative to that base.

Because there is no signature, detection relies entirely on the index-size invariant and on every
name and entry placement being valid.

## Support

| Capability | Status |
| --- | --- |
| Structural detection | Supported |
| Index-size validation | Supported |
| CP932 filenames | Supported |
| Base-relative offsets | Supported |
| Entry listing and extraction | Supported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
