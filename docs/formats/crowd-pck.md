# Crowd engine resource archives (PCK)

## Reference and attribution

- GARBro reference: `ArcFormats/Crowd/ArcPCK.cs`, class `PckOpener`
- GARBro tag: `PCK`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The resource archive has no signature and no extension gate, so the port registers no signature hints and relies
on the structure alone.

## Layout

| Offset | Size | Meaning |
| --- | --- | --- |
| 0x00 | 4 | Entry count |
| 0x04 | 0x0C × count | Index records |
| … | … | NUL-terminated names |
| … | … | Payloads |

The count must be positive and at most `0xFFFFF`, which is a different bound from the shared sanity check the
other ports use. The index area is `0x0C × count` bytes and must fit in the file.

A record holds four unused bytes, a 32-bit payload offset at +4 and a 32-bit stored size at +8. The reference
compares the payload offset against the **index size** — `0x0C × count`, not the end of the index — and requires
every payload to fit the file; the port mirrors both checks.

## Names

Names follow the index records, one per entry, as NUL-terminated CP932 strings. Each name is read inside a window
of at most 260 bytes or whatever is left before the end of the file, whichever is smaller. An empty name, and a
name that fills its whole window without a terminator, both reject the archive. Names are listed verbatim, since
the reference is not hierarchical.

## Support

| Capability | Status |
| --- | --- |
| Entry count with the `0xFFFFF` bound | Supported |
| 0x0C-byte index records with offset and size fields | Supported |
| Payload offset bound against the index size | Supported |
| Placement checks against the file size | Supported |
| NUL-terminated CP932 names behind the records | Supported |
| 260-byte name windows with empty and unterminated name rejection | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover two entries with one raw name and one containing a backslash, a zero count, a count
above the hard bound, a payload inside the index size, an empty name, a name without a terminator, and a payload
outside the archive.
