# Aoi BOX script archive

## Reference and attribution

- GARBro reference: `ArcFormats/Aoi/ArcBOX.cs`, class `BoxOpener`
- GARbro tag: `BOX`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The signature spells `AOIB` and a four-byte tag behind it names the version, one of six accepted values that
appear in three shapes: `X10` and `X12` for the newest pair, `OX7` and `OX6` with a terminating null, and `OX5`
and `OX4` with a trailing space. The entry count sits at 8, and each pair of versions shares a single key byte —
0xAD for four and five, 0xB4 for six and seven, 0xB2 for ten and 0xA5 for twelve — with which every payload byte
is exclusive-ored.

Version six and above keep each name in its own record: a 0x10-byte field, the data offset and the size, in
records of 0x18 bytes. The older versions use an offset ladder instead, where the word at 0x10 is the first
payload's offset and one more word follows per entry, so a size is the gap to the next offset and the last entry
runs to the end of the file. Those entries carry no names, so the reference builds them from the archive name, a
two-digit index and an `.evt` extension, and the port does the same with the version key kept per entry as
metadata.

## Support

| Capability | Status |
| --- | --- |
| `AOIB` signature and six version tags | Supported |
| Per-version key byte | Supported |
| Named records for versions six and above | Supported |
| Offset ladder for versions four and five | Supported |
| Generated `.evt` names with derived sizes | Supported |
| Full-coverage and placement validation | Supported |
| Single-byte keyed payload decryption | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the named layout with a key, the ladder layout with generated names, an unknown tag,
and the two newer layouts in their own notes.
