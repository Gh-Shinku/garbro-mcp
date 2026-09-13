# BlackRainbow/Melty PAK archive

## Reference and attribution

- GARBro reference: `ArcFormats/BlackRainbow/ArcPAK.cs`, class `PakOpener`
- GARbro tag: `PAK/MELTY`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The archive carries no signature and its index is *trailing*: the record count is the word eight bytes from the
end of the file and the index size the word after it, so the index begins that size before the trailer. The size
must leave the trailer and the index inside the file, and the format is registered for the `pak` extension.

Records hold a data offset, a packed size, an unpacked size and a character count followed by that many UTF-16LE
characters as the name — the reference reads the index through a `BinaryReader` configured for UTF-16, which
affects only the name since the numbers are read raw. A character count outside one to 0x100 rejects the archive,
as does a name the index cannot supply in full, and blank names are rejected by the port.

The unpacked size doubles as a flag: a sentinel of all ones means the payload is stored, and any other value means
it is deflated with that word as its expanded length. Payloads are validated against the file.

## Extraction

A deflated payload is streamed through zlib, and anything else is emitted verbatim. The reference decompresses
without checking the result against the declared length, so the port streams the output and marks those entries
as having an inexact size rather than failing them on a mismatch.

## Support

| Capability | Status |
| --- | --- |
| Trailing index count and size | Supported |
| `pak` extension requirement | Supported |
| Records with offset, packed and unpacked sizes | Supported |
| UTF-16LE names with their character count | Supported |
| Stored sentinel versus deflated payloads | Supported |
| Name length bounds and offset validation | Supported |
| zlib extraction for deflated payloads | Supported |
| Verbatim extraction for stored payloads | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover a stored entry, a deflated entry, a non-ASCII name, a zero name length, an empty count,
and the extension requirement.
