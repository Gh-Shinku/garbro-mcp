# Sophia NOR resource archives

## Reference and attribution

- GARBro reference: `Legacy/Sophia/ArcNOR.cs`, class `NorOpener` and its `NcmbDecompress`
- GARBro tag: `NOR`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The format has no registered signature; the marker behind the count is the whole detection, so the toolkit tries it for
every file.

| Offset | Size | Meaning |
| --- | --- | --- |
| 0x00 | 4 | Entry count |
| 0x04 | 9 | `NRCOMB01` and a null |
| 0x10 | — | Records: offset, size, null-terminated name |

Records are walked rather than indexed because the names are variable length. Every range is placement-checked.

## Payload resolution

What an entry is only becomes clear from its payload, so the port resolves it while listing: a payload that does not
start with `NCMB01` is stored as is. One that does is read further, and the method word at 0x28 decides:

| Method | Result |
| --- | --- |
| 0x1F4 or 0x67 | Stored behind a 0x2C-byte header, with the size taken from the header |
| anything else | Compressed to the unpacked size in the header, using the tree codec |

Both variants take their sizes from the header: the stored size at 0x10 and the unpacked size at 0x24. The payload
itself starts after the 0x2C-byte header.

## The tree codec

`NcmbDecompress` reads a root node, a tree size and the unpacked size, then one record per node — a node index followed
by its left and right children. Bits come from the most significant bit of each byte and walk the tree; a node whose
left child is -1 is a leaf, and its own index is the output byte.

The node table has six words per node although only two are used. The reference relies on a zero-initialized table and
would descend into node zero, or index out of range, on a malformed tree; the port rejects a node index outside the
table instead.

## Support

| Capability | Status |
| --- | --- |
| Structural detection through the `NRCOMB01` marker | Supported |
| Count at 0x00 and walked records from 0x10 | Supported |
| Placement validation | Supported |
| `NCMB01` payload header resolution | Supported |
| Stored-method payloads behind a 0x2C header | Supported |
| Packed payloads and the tree codec | Supported |
| Path normalization | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover stored payloads, a stored-method payload behind its header, a packed payload with a two-leaf
tree, a deeper tree whose bit runs cross byte boundaries, a foreign marker, an unsane count, an out-of-range payload, a
truncated stream and a node index outside the table.
