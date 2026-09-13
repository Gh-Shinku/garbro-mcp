# Maika BK resource archives

## Reference and attribution

- GARBro reference: `ArcFormats/Maika/ArcBK.cs`, class `BkOpener` and its `LzBitsDecompressor`
- GARBro tag: `DAT/BK`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

There is no signature. The archive ends with its index, which is itself compressed, and the two words at the start point
at it:

| Offset | Size | Meaning |
| --- | --- | --- |
| 0x00 | 4 | Offset of the compressed index |
| 0x04 | 4 | Size of the compressed index |
| 0x08 | — | Payloads |
| — | index size | Compressed index |

The offset plus the size has to equal the file size exactly, so an archive whose tail is not the index is rejected. The
index is decompressed with the bit codec and then holds a count and fixed-width records:

| Offset | Size | Meaning |
| --- | --- | --- |
| 0x00 | 4 | Entry count |
| — | 0x110 × count | Records: payload offset, stored size, unpacked size, padded name |

Names are CP932 fields of 0x104 bytes — the reference reads the whole field rather than stopping behind the terminator,
so records are fixed width regardless of name length. An entry is compressed exactly when its two sizes differ, and
entries named `.gpt` are typed as images. Names may hold backslashes, which the toolkit normalizes to forward slashes.

## The bit codec

`LzBitsDecompressor` reads bits from the most significant bit of each byte:

1. a set bit is a literal: eight bits appended to the output and to a 0x400-byte ring buffer;
2. a clear bit is a match: a ten bit ring distance and a five bit length, offset by two.

The ring write position starts at one, and a match reads from the ring while writing back into it, so a match that
overlaps its own output sees the bytes it just produced. Both uses advance their own cursors.

A stream that ends in the middle of a symbol is treated as a complete stream — the reference yields nothing more — so the
port stops at that symbol and returns what it decoded.

## Extraction

Stored payloads are handed out as they are. A compressed payload runs through the bit codec, is limited to the declared
unpacked size, and — only then — has every byte inverted when the entry is named `.gpa`. Because the reference returns
early for stored entries, an *un*compressed `.gpa` entry is handed out unchanged.

## Support

| Capability | Status |
| --- | --- |
| Structural detection through the trailing index | Supported |
| Index offset and size that must cover the file tail | Supported |
| LZ bits index decompression | Supported |
| Fixed-width records with offset, sizes and padded names | Supported |
| Compression flag from the size mismatch | Supported |
| LZ bits payload decompression and unpacked-size limit | Supported |
| `.gpa` inversion and `.gpt` image typing | Supported |
| Path normalization and placement validation | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover a compressed index with stored payloads, a packed entry, a packed `.gpa` entry and a stored one,
`.gpt` typing, an overlapping ring match, a truncated bit stream, an index that does not cover the tail, an index without
entries, a truncated index and an out-of-range entry.
