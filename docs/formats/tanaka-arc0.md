# Tanaka ARC0 archive

## Reference and attribution

- GARBro reference: `ArcFormats/Tanaka/ArcARC0.cs`, class `Arc0Opener`
- GARBro tag: `ARC0/WILL`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`ARC0` archives accept two signatures, `ARC0` and `TFA0`, and store a 32-bit total size at
offset 4 that must equal the file size. A 32-bit entry count sits at offset 8. The index starts
at 0x10 and uses 0x20-byte records with a 32-bit absolute offset, a 32-bit size, and a 20-byte
CP932 filename at +0x0c.

## Support

| Capability | Status |
| --- | --- |
| Dual signature detection | Supported |
| Total-size validation | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
