# MAGES MPK archive

## Reference and attribution

- GARBro reference: `ArcFormats/NitroPlus/ArcMPK.cs`, class `MpkOpener`
- GARBro tag: `MPK/MAGES`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`MPK` archives start with the bytes `MPK` and a NUL terminator. A 32-bit entry count sits
at offset 8 and the index begins at 0x48. Each 0x100-byte record stores:

| Offset | Size | Meaning |
| --- | ---: | --- |
| 0x00 | 8 | 64-bit absolute offset |
| 0x08 | 4 | packed size |
| 0x10 | 4 | unpacked size |
| 0x18 | 0xe0 | null-terminated CP932 filename |

GARbro reads the unpacked size into `PackedEntry` but this opener never decompresses, so the stored
bytes are exposed as-is. This port records the declared unpacked size in entry metadata.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| 64-bit offsets | Supported |
| CP932 filenames | Supported |
| Unpacked-size metadata | Supported |
| Entry listing and extraction | Supported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
