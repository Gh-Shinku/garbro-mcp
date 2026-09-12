# Silky's ARC archive

## Reference and attribution

- GARBro reference: `ArcFormats/Silky/ArcARC.cs`, class `ArcOpener`
- GARBro tag: `ARC/SILKY'S`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

Silky's archives are detected by the `.arc` extension. A 32-bit entry count sits at offset 0
and the index starts at 4. Each 0x28-byte record holds a null-terminated CP932 filename, a
32-bit absolute offset at +0x20, and a 32-bit size at +0x24. GARbro requires offsets to point
past the index and rejects archives with duplicate offsets.

## Support

| Capability | Status |
| --- | --- |
| Extension-based detection | Supported |
| Duplicate-offset rejection | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
