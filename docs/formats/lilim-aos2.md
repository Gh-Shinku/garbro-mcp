# LiLiM AOS version 2 archive

## Reference and attribution

- GARBro reference: `ArcFormats/Lilim/ArcAOS.cs`, class `Aos2Opener`, and
  `ArcFormats/HuffmanCompression.cs` (`HuffmanDecompressor`)
- GARBro tag: `AOSv2`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The first word must be zero, the base offset sits at 4 and the index size at 8, and the index itself
begins at 0x111. GARbro requires the base offset to point inside the file, the index to end inside it
as well, and the base offset to sit behind the index. The record count is the index size divided by
0x28, which also means every one of those slots is a record, so a name may not be empty.

Each record holds a 0x20-byte CP932 name, an offset relative to the base offset, and a size. Entries
named `*.scr` hold a Huffman stream, while `*.cmp` entries hold one too but are renamed to `*.abm` and
classified as images, a rename the reference performs while building the directory; the port mirrors it
so listing and extraction agree. Packed entries declare their unpacked size in the first four bytes of
the payload, which bounds the output, and the decoder is shared with the FGA layout through
`@garbro-mcp/codecs`.

## Support

| Capability | Status |
| --- | --- |
| `.aos` extension requirement | Supported |
| Zero first word requirement | Supported |
| Base offset, index size and layout validation | Supported |
| Record count validation | Supported |
| CP932 filenames with an empty-name rejection | Supported |
| Entry placement validation | Supported |
| Huffman decoding of `*.scr` entries | Supported |
| `*.cmp` decoding with rename to `*.abm` | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover plain entries with a renamed compressed image, a compressed script, the
extension requirement, and an index that overlaps the payloads.
