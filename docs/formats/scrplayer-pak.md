# ScrPlayer PAK resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/ScrPlayer/ArcPAK.cs`, class `PakOpener`
- GARbro tag: `PAK/ScrPlayer`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

Two signatures share the layout, and the third byte of the second one also marks the index as encrypted: the
reference then reads the index, rounds its buffer up to a whole number of words and exclusive-ors each word
with a repeating eight-entry key. Its cipher rejects a length that is not a multiple of four; the port
rejects such an archive rather than throwing.

The index follows the signature at 8 and its size sits at 4, bounded to at least 0x10 bytes and to end inside
the file. A record holds the data offset, the stored size and a name length byte, with the name following
that byte, and the next record begins at the name length rounded down to the record alignment plus eight. An
offset word of zero ends the index, which is how the reference stops before the payloads, and the port keeps
that terminator.

The alignment itself is not stored. `TestAlign` infers it: the first record's offset and size predict where
the second record must start once its span is rounded up to eight bytes, and the eight-byte alignment is
confirmed when the word at the position that layout implies holds exactly that value. When the eight-byte
reading then fails to parse, the reference retries with four-byte records, and the port reproduces both the
test and the fallback. Payloads are stored verbatim, and a blank name rejects the archive.

## Support

| Capability | Status |
| --- | --- |
| `pack` and `pac2` signatures | Supported |
| Index size bounds | Supported |
| Encrypted index with the eight-entry word key | Supported, non-aligned lengths rejected |
| Alignment inference with the eight-then-four fallback | Supported |
| Records with offset, size and a name length byte | Supported |
| Zero offset terminator | Supported |
| Entry placement validation | Supported |
| CP932 names with blank rejection | Supported |
| Verbatim extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover eight-byte records, an encrypted index, the four-byte fallback, a too-small index,
and a foreign signature.
