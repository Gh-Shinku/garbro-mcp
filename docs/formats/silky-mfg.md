# Silky's MFG archive

## Reference and attribution

- GARBro reference: `ArcFormats/Silky/ArcMFG.cs`, class `MfgOpener`
- GARBro tag: `MFG`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`ALPF` archives start with the ASCII signature `ALPF` and a 32-bit entry count at offset 4
that must be between 1 and 0xfffff. The index starts at 8 and uses 0x14-byte records with a
null-terminated CP932 filename and a 32-bit offset at +0x10. Entries span from their own offset
to the next record's offset; the last entry ends at the end of file.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| Derived entry sizes | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
