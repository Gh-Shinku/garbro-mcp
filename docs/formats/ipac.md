# IPAC archive

## Reference and attribution

- GARBro reference: `ArcFormats/Ipac/ArcIPAC.cs`, class `PakOpener`
- GARBro tag: `PAK/IPAC`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`IPAC` archives start with the ASCII signature `IPAC` and a 16-bit entry count at offset 4.
The index starts at 8 and uses 0x2c-byte records with a 0x20-byte CP932 filename, a 32-bit
offset at +0x24, and a 32-bit size at +0x28. Entries whose payload starts with `IEL1` carry a
32-bit unpacked size at +4 and a default-variant LZSS stream at +8.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| IEL1 LZSS decompression | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
