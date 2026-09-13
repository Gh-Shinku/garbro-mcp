# Tanaka VPK audio archive

## Reference and attribution

- GARBro reference: `ArcFormats/Tanaka/ArcVPK.cs`, class `VpkOpener`
- GARBro tag: `VPK1`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`VPK0` and `VPK1` archives store the data size at 4, a record count at 8, and the index size at 0x0c;
GARbro requires the two sizes to add up to the file size, so the stored data size covers the 0x20
header as well. The index starts at 0x20 and the payloads follow it directly.

The version digit at offset 3 selects the record layout. Version 1 records use a four-byte name
field, a 16-bit field, a second 16-bit field, a 32-bit value, and the 32-bit offset and size. Version
0 records use a two-byte name field with a single 32-bit value instead. GARbro composes every entry
name from the stored stem, the numeric fields, and a `.wav` extension.

## Support

| Capability | Status |
| --- | --- |
| Signature detection for both versions | Supported |
| Version-dependent record layout | Supported |
| Version-dependent name field width | Supported |
| Composed `.wav` entry names | Supported |
| Data and index size validation | Supported |
| Entry placement validation | Supported |
| CP932 name stems | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover both versions, name composition, and size mismatch rejection.
