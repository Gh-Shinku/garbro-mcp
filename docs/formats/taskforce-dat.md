# Taskforce tskforce archive

## Reference and attribution

- GARBro reference: `ArcFormats/Taskforce/ArcDAT.cs`, class `DatOpener`
- GARBro tag: `DAT/TASKFORCE`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`tskforce` archives start with the ASCII signature `tskf` followed by `orce`, a 32-bit entry
count at offset 8, and an index at 0x0c. Records are 0x10c bytes with a 0x100-byte CP932 name,
a 32-bit offset at +0x100, a 32-bit unpacked size at +0x104, and a 32-bit packed size at +0x108.
Entries whose unpacked size differs from the packed size use the default LZSS variant.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| Default LZSS decompression | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
