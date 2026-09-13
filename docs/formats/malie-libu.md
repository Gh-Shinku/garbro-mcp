# Malie LIBU resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/Malie/ArcLIBU.cs`, class `LibUOpener` and its `LibUReader`
- GARBro tag: `LIBU`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The archive is a tree of directory blocks. Every block starts with the `LIBU` signature, two words — of which the port
reads the second as the entry count at 0x08 — and its entries. Because blocks nest inside the same file, each block's
entries follow from its own offset plus 0x10.

An entry record has no fixed length:

| Offset | Size | Meaning |
| --- | --- | --- |
| 0x00 | 0x44 | Name, thirty-four UTF-16 code units, read up to its first null character |
| 0x44 | 4 | Stored size |
| 0x48 | 8 | Offset, relative to the block that holds the record |

The next record follows immediately, so the index is walked rather than indexed.

## Nesting

A name without a dot is tried as a nested block first. When the block at the recorded offset parses, its children are
added with that name as their path prefix and the directory itself is not listed; when it does not parse, the name is
listed as a stored range. Names that carry a dot are always listed, even when their target happens to look like a block.

Paths use backslashes, which the toolkit normalizes to forward slashes — `SUBDIR\INNER.DAT` is listed as
`SUBDIR/INNER.DAT`. Every payload is stored as is and every placement is validated.

The reference recurses without a limit; the port stops at a depth of 64 so a crafted archive cannot exhaust the stack.

## Name buffer

GARbro reuses one thirty-four-character buffer for every name, so a short read leaves the previous name's characters in
place and the search for the terminating null runs over them. The port keeps the same buffer and the same search, so it
resolves names identically, including the reference's habit of searching for the first null *character* rather than the
first null byte.

## Support

| Capability | Status |
| --- | --- |
| `LIBU` block signature | Supported |
| Nested blocks with per-block base offsets | Supported |
| Per-block entry counts | Supported |
| Variable-length records with UTF-16 names | Supported |
| Sizes and block-relative offsets | Supported |
| Dot rule for directory detection | Supported |
| Path prefixing of nested entries | Supported |
| Reused name buffer semantics | Supported |
| Raw payload extraction and placement validation | Supported |
| Depth guard for crafted archives | Supported |
| Malie decryptor schemes | Unsupported |
| Archive creation | Unsupported |

Synthetic fixtures cover a flat archive, a nested block with prefixed paths, a dotless name whose target is not a block,
a dotted name whose target is a block, a foreign signature, an empty root block and an out-of-range payload.
