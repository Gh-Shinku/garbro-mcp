# Winters IFP archive

## Reference and attribution

- GARBro reference: `ArcFormats/Winters/ArcIFP.cs`, class `IfpOpener`
- GARBro tag: `IFP`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

An `IFP` archive starts with the `IAGS` signature, the marker `_IFP_01` padded with spaces at 4, a
version word at 0x10 that must equal one, and a byte count at 0x18. That count excludes a trailing
sentinel record, so GARbro derives the entry count as `count / 0x10 - 1`. Records start at 0x20 and
are 0x10 bytes: a 16-bit type, a 16-bit mask type, the data offset, the size, and the mask size.

Zero-type records are skipped but still advance the walk. GARbro assigns an extension from the type
code for bitmaps, PNGs, and JPEGs, and appends a second entry named `<stem>M.bmp` for bitmap masks
when the mask type is a bitmap and the mask size is non-zero.

## Support

| Capability | Status |
| --- | --- |
| Signature, marker, and version detection | Supported |
| Sentinel-adjusted record count | Supported |
| Zero-type record skipping | Supported |
| Type-to-extension mapping | Supported |
| Bitmap mask entries | Supported |
| Entry placement validation | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the record walk, type mapping, mask entries, zero-type skipping, and
version rejection.
