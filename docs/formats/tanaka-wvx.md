# Tanaka WVX audio archive

## Reference and attribution

- GARBro reference: `ArcFormats/Tanaka/ArcWRC.cs`, class `WrcOpener`
- GARBro tag: `WVX`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`WVX0` archives start with the ASCII signature `WVX0` and a 32-bit total size that must equal
the file size. A 32-bit entry count sits at offset 8. The index starts at 0x10 and uses 0x20-byte
records with a 28-byte CP932 name and a 32-bit offset at +0x1c. Every entry spans from its own
offset to the next record's offset; the last entry ends at the end of file.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| Total-size validation | Supported |
| Derived entry sizes | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
