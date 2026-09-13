# SFA engine FGA archive

## Reference and attribution

- GARBro reference: `ArcFormats/Lilim/ArcFGA.cs` (`FgaOpener`), `ArcFormats/Lilim/ArcAOS.cs`
  (`AosOpener`, `PackedEntry`), and `ArcFormats/HuffmanCompression.cs` (`HuffmanDecompressor`)
- GARBro tag: `FGA`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

An FGA archive is a chain of exactly 0x318-byte index blocks. Inside a block, records are 0x18 bytes
long and hold a 0xC-byte name, a data offset, and a size. Two first bytes are special: a `0xFF` record
continues the index at the offset stored in its own offset field, and a zero first byte ends the block.
GARbro requires a continuation to move strictly forward, which also keeps the chain from looping back;
the port keeps that rule and additionally bounds the number of blocks and entries so a damaged index
cannot allocate without limit.

Entries named `*.scr` are Huffman-compressed. GARbro wraps them in a limit stream, so the unpacked size
in the first four bytes of the payload is a bound rather than an exact length and the port marks those
entries accordingly and exposes the value as metadata. The Huffman tree travels inside the same bit
stream as the data: a set bit introduces an internal node whose two children follow, a clear bit
introduces a leaf holding an eight-bit value, and decoding walks that tree one bit per level until it
reaches a leaf. The decoder is shared with the sibling AOS formats through `@garbro-mcp/codecs`.

## Support

| Capability | Status |
| --- | --- |
| `.fga` extension requirement | Supported |
| Chained 0x318-byte index blocks | Supported |
| Backward continuation rejection | Supported |
| Block and entry bounds | Supported |
| CP932 filenames | Supported |
| Entry placement validation | Supported |
| Huffman decoding of `*.scr` entries | Supported |
| Unpacked size bound and metadata | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover a chained index with a compressed script, the zero-byte block end, the
extension requirement, and a non-forward continuation. The codec has its own unit suite covering a
two-leaf tree, a leaf root, padding after the last data bit, the tree size limit, and a truncated tree.
