# Aquarium AAP archive

## Reference and attribution

- GARBro reference: `Legacy/Aquarium/ArcAAP.cs`, class `AapOpener`
- GARBro tag: `AAP`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`FPARC10` archives store a 32-bit index offset at 0x10 and a 32-bit entry count at 0x14. The
index uses 0x30-byte records with a 0x10-byte CP932 filename, a 32-bit offset at +0x10 relative
to the end of the index, a 32-bit unpacked size at +0x14, and a 32-bit packed size at +0x18.
A non-zero unpacked size marks a Cp2 LZ entry.

The Cp2 LZ stream starts with an 8-byte header and then uses literals, `00 00` zero escapes,
and `00 count offset` back-references with overlapping copies, matching
`Cp2Reader.DecompressLz`.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| Cp2 LZ decompression | Supported |
| Base-relative offsets | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
