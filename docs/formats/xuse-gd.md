# Xuse GD archive

## Reference and attribution

- GARBro reference: `ArcFormats/Xuse/ArcGD.cs`, class `GdOpener`
- GARBro tag: `GD/Xuse`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`GD` archives are detected by extension and keep their offset table in a sibling `.dll` file.
The archive stores a 32-bit entry count at offset 0 that must be sane and must not look like an
`MZ` executable header. The DLL holds 8-byte records from offset 4 with a 32-bit offset and a
32-bit size; offsets must be strictly increasing and greater than 3. Entries are named
`<basename>#NNNNN`.

## Support

| Capability | Status |
| --- | --- |
| Extension-based detection | Supported |
| Companion `.dll` index | Supported |
| Monotonic offset validation | Supported |
| Generated entry names | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
