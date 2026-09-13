# LiLiM/Le.Chocolat AOS archive

## Reference and attribution

- GARBro reference: `ArcFormats/Lilim/ArcAOS.cs`, class `AosOpener`, and
  `ArcFormats/HuffmanCompression.cs` (`HuffmanDecompressor`)
- GARBro tag: `AOS`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The AOS index is a linked list of 0x20-byte records. A name field filled with `0xFF` is a link whose
offset word is added to the position after that record, so a link can skip any number of records; a
name field starting with a zero ends the index; anything else names an entry whose data offset sits at
0x10 and whose size sits at 0x14.

The word at 0x10 is also the first record's data offset, and GARbro requires it to be aligned to the
record size and to point at a field that looks like a link or an end marker, meaning the first payload
must begin with sixteen `0xFF` bytes or with a zero. Names must be non-empty and must differ from the
previous name, so consecutive duplicates are rejected.

Because AOS has neither a signature nor an extension to be detected by, the port adds a placement check
the reference omits as a documented hardening, and it treats a field read that runs past the end of the
file as a failure the way GARbro's `SequenceEqual` does implicitly. Entries named `*.scr` hold a
Huffman stream whose output size is bounded by the word in front of it, decoded through
`@garbro-mcp/codecs`.

## Support

| Capability | Status |
| --- | --- |
| Non-zero first byte requirement | Supported |
| First record pointer alignment and field check | Supported |
| Link records with arbitrary skips | Supported |
| Zero-byte index end | Supported |
| Consecutive duplicate rejection | Supported |
| Empty and whitespace name rejection | Supported |
| CP932 filenames | Supported |
| Huffman decoding of `*.scr` entries | Supported |
| Entry placement validation | Supported as a documented hardening |
| Archive creation | Unsupported |

Synthetic fixtures cover link walking with a skipped record, a compressed script, consecutive duplicate
rejection, and the zero first byte requirement.
