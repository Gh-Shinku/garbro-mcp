# TamaSoft ADV system resource archives (EPK)

## Reference and attribution

- GARBro reference: `ArcFormats/TamaSoft/ArcEPK.cs`, class `PakOpener`
- GARBro tag: `EPK`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

## Header and index

| Offset | Size | Meaning |
| --- | --- | --- |
| 0x00 | 4 | `EPK ` signature |
| 0x04 | 4 | Index size plus 0x20 |
| 0x18 | 4 | Entry count |
| 0x20 | … | Index records and name blocks |

The index size is the value at 0x04 minus 0x20, computed as an unsigned 32-bit difference, so a smaller value
wraps to a huge index that the bounds check rejects. The index region `[0x20, 0x20 + index size)` must fit in the
file, and the reference reserves exactly that region: every index read, including the name blocks, must stay
inside it.

Records are 0x28 bytes and start at 0x20:

| Record offset | Size | Meaning |
| --- | --- | --- |
| +0x08 | 4 | Name offset, absolute in the file and inside the index region |
| +0x10 | 8 | Payload offset in the virtual offset space |
| +0x18 | 4 | Stored size |

A name block is a 32-bit length followed by that many bytes, each negated with `0xFF` and then decoded as CP932.
A length that is not positive, or that is at least the index size, rejects the archive, and the block must lie
inside the index region. Names are hierarchical, so backslashes become forward slashes.

## Multi-part archives

Payload offsets are **virtual**: the archive itself occupies `[0, size)` and each sibling part continues where the
previous file ended, for up to nine parts named `<archive>.e01` through `<archive>.e09`. The reference collects
parts while they exist and stops at the first missing one, ignoring any later part.

Each entry is then rebased into the part that contains its offset, and the port keeps that part number in the
entry's metadata. An entry may run past the end of its part, in which case extraction joins the rest of that part
with the beginning of the next one, as the reference does. An entry whose offset lies beyond every part keeps its
unrebased offset, mirroring the reference's `-1` part number, and extraction then reads from the archive itself.

## Support

| Capability | Status |
| --- | --- |
| `EPK ` signature and index size field | Supported |
| Entry count and 0x28-byte index records | Supported |
| Index-reserved name blocks inside the index region | Supported |
| Negated CP932 names and hierarchical path normalization | Supported |
| Virtual offset space across `.e01`…`.e09` parts | Supported |
| Part scanning that stops at the first missing part | Supported |
| Per-entry part assignment and rebasing | Supported |
| Payloads that span a part boundary | Supported |
| Placement checks against the whole offset space | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the archive and its first part with four entries, one of which spans the part boundary
and one that lies wholly inside the part, a hierarchical name, a gap in the part sequence, a payload beyond every
part, a name length outside the index, an insane entry count, an index that does not fit the file, and a wrong
signature.
