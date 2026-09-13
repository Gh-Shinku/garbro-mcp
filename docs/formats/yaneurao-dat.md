# Yaneurao DAT resource archives

## Reference and attribution

- GARBro reference: `Legacy/Yaneurao/ArcDAT.cs`, classes `PackOpener` (`DAT/yanepkDx`) and `PackExOpener`
  (`DAT/yanepkEx`)
- GARBro tags: `DAT/yanepkDx`, `DAT/yanepkEx`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Two variants

Both variants share the same record layout — a CP932 name, then the payload offset, the unpacked size and the stored
size — and the same opener. They differ in their header, name width and how the entry count is found.

| | `DAT/yanepkDx` | `DAT/yanepkEx` |
| --- | --- | --- |
| Marker | `0x0C09140A`, or `yane` + `pkDx` | `yane` + `pkEx` |
| Entry count | derived, see below | at 0x08 |
| Name field | 0x100 bytes | 0x20 bytes |
| Record stride | 0x10C | 0x2C |
| Table start | 0x0C | 0x0C |

### The derived count

`yanepkDx` does not store a count. The payload offset of the first entry sits at 0x10C — the very slot that follows a
0x100-byte name field — and the table runs from 0x0C, so `(first_offset - 0x0C) / 0x10C` is the count. The first
record's own offset is therefore what fixes the table size, and the value must be at least 0x118 and below the archive
size.

The division truncates, exactly as in the reference: a gap between the end of the table and the recorded payload offset
that is not a whole multiple of the stride leaves its trailing bytes unread, and the entries that fit are listed.

A file that starts with `yane` must continue with `pkDx`; a file that starts with the marker bytes stands on its own.
Because both variants are keyed on the same `yane` prefix, each one rejects the other's marker.

## Entries

An entry is compressed exactly when its stored size differs from its unpacked size, and compressed entries run through
the default GARbro LZSS stream (4 KiB frame, initialization position 0xFEE, literal on a set bit). Uncompressed entries
are handed out as stored. Names may hold backslashes, which the toolkit normalizes to forward slashes.

## Support

| Capability | Status |
| --- | --- |
| `0x0C09140A` and `yane` + `pkDx` signatures | Supported |
| `yane` + `pkEx` signature | Supported |
| Derived entry count for `yanepkDx` | Supported |
| Entry count at 0x08 for `yanepkEx` | Supported |
| CP932 name fields, both widths | Supported |
| Offset, unpacked size and stored size records | Supported |
| Packed flag from the size mismatch | Supported |
| Default LZSS unpacking and store pass-through | Supported |
| Path normalization and placement validation | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover both variants, packed and plain entries, the shared opener, a table whose gap is a partial
stride, a nested name, an out-of-range payload, a payload offset below the first record, an unsane count, a truncated
table and the mutual rejection between the variants.
