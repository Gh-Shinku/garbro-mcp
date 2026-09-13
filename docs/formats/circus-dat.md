# Circus DAT resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/Circus/ArcCircus.cs`, class `DatOpener`
- GARbro tag: `DAT/CIRCUS`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The entry count sits at 0 and must exceed one, because the announced count includes a final record that only
supplies an offset: the reference decrements the count and returns one entry fewer than the word promises.
Records begin at 4 and are a fixed-width name field followed by one offset word, and sizes are derived
rather than stored — each entry spans from its own offset to the next record's, with the last one running to
the end of the file.

The name field width is not recorded, so three candidates of 0x24, 0x30 and 0x3C bytes are tried in order
and the first that reads cleanly wins, which means a file whose names merely fit a narrower field is still
read the way the reference would read it. Two quirks are mirrored: a candidate is rejected when the last
four bytes of the first name field happen to equal the distance between the first two offsets, a heuristic
that separates this layout from a sibling format, and every offset is compared against the index size
alone rather than the four header bytes in front of it. Payloads are stored verbatim.

## Support

| Capability | Status |
| --- | --- |
| `dat` extension requirement | Supported |
| Entry count above one and its limit | Supported |
| Decremented count returning one fewer entry | Supported |
| Three candidate name widths with first-match ordering | Supported |
| Derived sizes with the last entry running to the file end | Supported |
| First name tail heuristic rejection | Supported |
| Offset compared against the index size | Supported |
| Entry placement validation | Supported |
| CP932 names with empty rejection | Supported |
| Verbatim extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover all three name widths, the first-name-tail heuristic, a count that is not above one,
and the extension requirement.
