# Silky's Azurite resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/Silky/ArcAzurite.cs` (`SilkyArcOpener`) and
  `ArcFormats/Silky/ArcAi6Win.cs` (`Ai6Opener.OpenEntry`), with `ArcFormats/LzssStream.cs`
- GARBro tag: `ARC/AZURITE`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The index size sits at 0 and the index itself runs from offset 4 for that many bytes, which GARbro
requires to be at least ten and to stay clear of the end of the file. The first index byte may not be
zero. Records follow each other without padding: a one-byte name length, that many name bytes, then
three big-endian words holding the stored size, the unpacked size, and the data offset, which must land
behind the index.

Names are obfuscated with a key that starts at the name length and decreases by one per byte, so
GARbro adds that key while decrypting and the stored form subtracts it. An entry counts as compressed
whenever its stored size differs from its unpacked size, and `Ai6Opener.OpenEntry` decodes those as
plain LZSS streams. GARbro's `LzssStream` defaults — a 0x1000-byte ring frame, zero fill, and an
initial position of 0xFEE — are exactly the defaults of `@garbro-mcp/codecs`, so the shared decoder is
used without overrides. Because that decoder stops at the end of the stored stream rather than at the
declared output length, packed entries are marked as having an inexact size.

## Support

| Capability | Status |
| --- | --- |
| `.arc` extension requirement | Supported |
| Index size bounds (at least ten, inside the file) | Supported |
| Non-zero first index byte requirement | Supported |
| Name obfuscation and length validation | Supported |
| Big-endian stored size, unpacked size and offset | Supported |
| Data offset behind the index | Supported |
| Entry placement validation | Supported |
| Packed detection from size inequality | Supported |
| LZSS extraction with GARbro's default settings | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover a plain entry and an LZSS entry, the extension requirement, the index size
floor, and a data offset pointing inside the index.
