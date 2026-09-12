# Succubus ARC1 archive

## Reference and attribution

- GARBro reference: `ArcFormats/Succubus/ArcARC.cs`, class `ArcOpener`
- GARBro tag: `ARC/ARC1`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`ARC1` archives start with the ASCII signature `ARC1`, a 32-bit entry count at offset 4, and
a 32-bit index offset at offset 8 that must be at least 0x10. The index uses 0x18-byte records
with a null-terminated CP932 name, a 32-bit size at +0x10, and a 32-bit absolute offset at
+0x14. GARbro also re-checks the index pointer before every record, so the index must stay
inside the file.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| Pointed-to index | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
