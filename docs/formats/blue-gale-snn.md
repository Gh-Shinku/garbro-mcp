# BlueGale SNN archive

## Reference and attribution

- GARBro reference: `ArcFormats/BlueGale/ArcSNN.cs`, class `SnnOpener`
- GARBro tag: `SNN`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`SNN` archives are detected by extension and keep their index in a sibling `.Inx` file. The
index stores a 32-bit entry count at offset 0 and 0x48-byte records with a 0x40-byte CP932
filename, a 32-bit offset at +0x40, and a 32-bit size at +0x44. Entry placement is checked
against the main archive, not the index file.

## Support

| Capability | Status |
| --- | --- |
| Extension-based detection | Supported |
| Companion `.Inx` index | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
