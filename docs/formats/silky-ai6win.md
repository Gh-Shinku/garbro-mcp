# AI6WIN engine resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/Silky/ArcAi6Win.cs`, class `Ai6Opener`, with `ArcFormats/LzssStream.cs`
- GARBro tag: `ARC/AI6WIN`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The entry count sits at 0 and every record is 0x110 bytes: a 0x104-byte name field followed by three
big-endian words holding the stored size, the unpacked size, and the data offset. The offset must land
behind the index.

Names are obfuscated with a key that starts at the name length plus one and decreases by one per byte,
and GARbro subtracts that key while decrypting — the opposite direction from the sibling Azurite
layout, which adds a key starting at the name length. GARbro also rejects any decrypted name holding a
character that is invalid in a file name, with an exception for the path separator, which is a strong
structural check because this format carries neither a signature nor a distinguishing extension.

An entry counts as compressed whenever its stored size differs from its unpacked size, and it is then
decoded as a plain LZSS stream using GARbro's `LzssStream` defaults, which match `@garbro-mcp/codecs`.
The shared opener lives in `lzss-entry.ts` and also serves the Azurite layout.

## Support

| Capability | Status |
| --- | --- |
| `.arc` extension requirement | Supported |
| Entry count validation | Supported |
| Fixed 0x110-byte records | Supported |
| Name obfuscation and length validation | Supported |
| Invalid file name character rejection | Supported |
| Big-endian stored size, unpacked size and offset | Supported |
| Data offset behind the index | Supported |
| Entry placement validation | Supported |
| LZSS extraction with GARbro's default settings | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover a nested plain entry and an LZSS entry, the extension requirement, invalid
name character rejection, and a data offset pointing inside the index.
