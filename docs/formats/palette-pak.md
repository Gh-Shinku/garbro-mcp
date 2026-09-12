# Palette FilePack archive

## Reference and attribution

- GARBro reference: `ArcFormats/Palette/ArcPAK.cs`, class `FilePackOpener`
- GARBro tag: `PAK/FilePack`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`FilePack` archives start with the ASCII signature `FilePack` and a 32-bit entry count at
offset 8. The index starts at 0x0c and uses 0x28-byte records with a 0x20-byte name field
XORed with 0xff, a 32-bit size at +0x20, and a 32-bit absolute offset at +0x24.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| XOR-0xFF name field | Supported |
| Absolute offsets | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
