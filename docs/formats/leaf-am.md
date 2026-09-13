# Leaf video resources archives (AM)

## Reference and attribution

- GARBro reference: `ArcFormats/Leaf/ArcAM.cs`, class `AmOpener`
- GARBro tag: `AM/Leaf`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior. The reference's optional
`AmScheme.DecryptTable`, which is supplied by user schemes, is not reproduced; the default scheme carries no
table, so extraction returns stored bytes.

## Header and index

| Offset | Size | Meaning |
| --- | --- | --- |
| 0x00 | 4 | `am00` |
| 0x04 | 4 | Index size |
| 0x08 | 1 | Index key byte |
| 0x09 | size | Masked index |

The whole index is exclusive-ored with the key byte before it is parsed, and a short read rejects the
archive. Records follow each other without a stride and run to the end of the index:

| Field | Size | Meaning |
| --- | --- | --- |
| Name | variable | NUL-terminated CP932 |
| Offset | 4 | Relative to the end of the index |
| Size | 4 | Stored size |

A missing terminator, an empty name, a trailing record that is shorter than its tail, or a payload outside
the archive all reject the archive. An empty index is accepted and yields an empty listing, matching the
reference.

The format is not hierarchical, so names are kept verbatim: backslashes stay part of the name.

## Payload handling

No compression is involved. The reference wraps the stored stream in `AmStream`, which exclusive-ors the
payload with a 0x10000-byte table at the absolute stream position, but that table only exists when a user
scheme provides one. With the default scheme the payload is returned as it is.

## Support

| Capability | Status |
| --- | --- |
| `am00` signature, index size and key byte | Supported |
| Whole-index exclusive-or | Supported |
| NUL-terminated CP932 names | Supported |
| Offsets relative to the index end and stored sizes | Supported |
| Placement checks for every record | Supported |
| Walk to the end of the index, including the empty index | Supported |
| User scheme decryption tables | Unsupported |
| Extension-based entry typing | Unsupported |
| Archive creation | Unsupported |

Synthetic fixtures cover a two-entry archive, a non-zero key byte, a name with a backslash separator, an
empty index, a foreign signature, an index that reaches past the archive, an empty name, a name that runs
past the index, a trailing partial record, a payload outside the archive, and a file too small for its
header.
