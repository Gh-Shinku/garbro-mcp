# AdvSys_T FPK archive

## Reference and attribution

- GARBro reference: `ArcFormats/AdvSys/ArcAdvSysT.cs`, class `FpkOpener`
- GARBro tag: `FPK/MFWY`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2016 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`MFWY` archives start with the ASCII signature `MFWY`, a 32-bit entry count at offset 4, and a
32-bit data offset at offset 8 that must follow the index. The index starts at 0x10 and uses
0x20-byte records with a 0x18-byte CP932 filename, a 32-bit size at +0x18, and a 32-bit offset
at +0x1c. Offsets must not point back into the index.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| Index-following offsets | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
