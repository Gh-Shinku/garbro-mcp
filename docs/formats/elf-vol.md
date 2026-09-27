# Ancient elf VOL resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/elf/ArcVOL.cs`, class `VolOpener`
- GARbro tag: `VOL/ELF`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The file needs a `vol` extension and no signature beyond its first word, which is the first payload's offset and
must be at least 0x10, aligned to sixteen bytes, and inside the file. Dividing that offset by four gives the
number of words the offset table may hold, so the count is an upper bound derived from the very offset it
describes rather than a stored value — a rare shape, and the reason the count needs no separate sanity bound
beyond the one the reference applies.

The table is read from offset 4 while its words keep increasing, and the walk stops early when a word equals the
file length. That word is a terminator, so a table can end wherever it appears rather than running to the count,
and it also serves as the last entry's end.

Every entry then spans the gap between two consecutive offsets. The reference *skips* a pair whose gap is zero
instead of emitting an empty entry, which leaves a hole in the generated four-digit numbering — an entry after a
skipped pair keeps the index of its pair, not of its position in the directory. Names are built from the archive
name and that index. Each non-empty payload with at least four bytes is classified through the shared GARBro
signature catalogue. A unique match supplies its resource type and primary extension; ambiguous or unknown
signatures leave the generated name alone. Payloads are stored verbatim.

## Support

| Capability | Status |
| --- | --- |
| `vol` extension requirement | Supported |
| First offset bounds and sixteen-byte alignment | Supported |
| Count derived from the first offset | Supported |
| Non-decreasing offset table with early termination | Supported |
| Derived sizes from consecutive offsets | Supported |
| Zero-length span skipping with the numbering hole | Supported |
| Generated four-digit names | Supported |
| Verbatim extraction | Supported |
| Type classification by content signature | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover three derived spans, a table ending at its terminator, catalogue-wide signature typing, a
skipped zero-length span, an unaligned first offset, and the extension requirement.
