# Nitro+ NPP archive

## Reference and attribution

- GARbro reference: `ArcFormats/NitroPlus/ArcNPP.cs`, class `NppOpener`
- GARbro tag: `NPP`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`NPP` archives start with the ASCII signature `nitP` and a 32-bit entry count at offset 4. The
index begins at 8 and uses 0x90-byte records:

| Offset | Size | Meaning |
| --- | ---: | --- |
| 0x00 | 4 | absolute 32-bit offset |
| 0x04 | 4 | packed size |
| 0x08 | 4 | unpacked size |
| 0x0c | 2 | non-zero when the entry is LZSS-compressed |
| 0x10 | 0x40 | null-terminated CP932 subdirectory |
| 0x50 | 0x40 | null-terminated CP932 filename |

Paths are the subdirectory and filename joined with a backslash. Compressed entries use the default
GARbro LZSS variant: a 4 KiB frame, initial position 0xfee, and set control bits marking literals.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| Hierarchical CP932 names | Supported |
| Default LZSS decompression | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover raw and compressed records, hierarchical names, and the declared unpacked
size.
