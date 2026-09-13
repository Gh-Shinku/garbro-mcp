# Melonpan TTD resource archive

## Reference and attribution

- GARBro reference: `Legacy/Melonpan/ArcTTD.cs`, class `TtdOpener`, with `ArcFormats/LzssStream.cs`
- GARbro tag: `TTD`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The signature is the four bytes `WCW\0`, so the reference compares the whole 32-bit word rather than
just the three letters. The entry count sits at 4 and the index starts at 12 with 0xC-byte record
headers — a size word and an offset word — followed by a name whose width is not stored anywhere.
GARbro derives it from the first record's offset, `(first_offset - 12) / count - 0xC`, requires at least
eight bytes, and then advances every record by that fixed width.

GARbro never marks an entry as packed while reading the index; `TtdOpener.OpenEntry` marks it lazily
when a payload begins with `DSFF`, in which case the following word is the unpacked size and everything
behind the eight-byte header is an LZSS stream whose ring position is raised to 0xFF0 instead of using
the default. The port performs that inspection while reading the index so listing and extraction agree,
passes the overridden ring position to the shared decoder, and marks those entries as having an inexact
size because the decoder stops at the end of the stored stream.

## Support

| Capability | Status |
| --- | --- |
| Four-byte `WCW\0` signature | Supported |
| Entry count validation | Supported |
| Derived name width with its eight-byte minimum | Supported |
| Fixed-width record walk | Supported |
| CP932 filenames | Supported |
| Entry placement validation | Supported |
| `DSFF` detection and unpacked size word | Supported |
| LZSS extraction with the 0xFF0 ring position override | Supported |
| Verbatim extraction for other payloads | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover a stored payload, a `DSFF` payload decoded with the overridden ring position, a
non-zero fourth signature byte, a name width below the minimum, and an empty count.
