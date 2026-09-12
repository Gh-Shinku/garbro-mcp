# RHSS CRG archive

## Reference and attribution

- GARBro reference: `Legacy/Rhss/ArcCRG.cs`, class `PakOpener`
- GARBro tag: `DAT/CRG`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2016 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`CRG` archives start with the bytes `CRG` and a NUL, followed by a 32-bit entry count at
offset 4. The index starts at 8 and uses 60-byte records with a 32-bit offset, a 32-bit size,
and a 0x30-byte CP932 name at +8.

Payloads whose first four bytes are `CMP` plus a NUL are zlib-compressed; the decompressed
bytes are XORed with 0xff, and the unpacked size is stored at header offset 0x4c.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| Zlib decompression | Supported |
| XOR-0xFF post-processing | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
