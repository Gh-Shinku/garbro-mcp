# Tanaka WSM2 music archive

## Reference and attribution

- GARBro reference: `ArcFormats/Tanaka/ArcWSM.cs`, class `Wsm2Opener`
- GARbro tag: `WSM2`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

Two signatures share this layout — `WSM2` and `WSM3`, the latter whose entries carry one more size word — with the
index size at 4, the count at 0x0C, and a table offset and count at 0x10 and 0x14. Unlike the earlier versions
the index is not at the start of the file: the reference reads it from 0x40 for `index_size` bytes, so every
pointer in it is relative to that position, and it rejects an index that would reach the end of the file.

The table has 0x20-byte records whose span is biased: the reference subtracts a fixed 0x14 from the offset word
and adds the same to the size word, and for version three adds one further size word. Names come from separate
records that *follow* the table rather than sitting behind each name: each record points at a name and then names
an entry index, where a zero means "the entry with the same number as this record". A name that points at an entry
beyond the table rejects the archive.

The reference finally checks whether those names are unique, and when they are not it prefixes every entry with
its two-digit position. The port reproduces that pass, and payloads are stored verbatim.

## Support

| Capability | Status |
| --- | --- |
| Both signatures with the version word | Supported |
| Index at 0x40 with relative pointers | Supported |
| Bias-adjusted table records | Supported |
| Version three's extra size word | Supported |
| Name records with an entry index and the zero convention | Supported |
| Unique-name checking with index prefixes | Supported |
| Entry placement validation | Supported |
| Verbatim extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover a name record naming its own entry and a name that points past the table.
