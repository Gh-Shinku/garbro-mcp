# Artemis engine resource archives (PFS)

## Reference and attribution

- GARBro reference: `ArcFormats/Artemis/ArcPFS.cs`, class `PfsOpener`
- GARBro tag: `PFS`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior. Names use the reference's
default code page (CP932); the alternate UTF-8 session setting and its retry path are not reproduced.

## Signature and version

Every archive starts with `pf` and a version digit at 0x02. The digit selects the layout:

| Version | Layout | Encryption |
| --- | --- | --- |
| 2 | `pf2` | None |
| 6 | `pf6` | None |
| 8 | `pf8` | Payloads exclusive-ored with the index hash |

The reference's encryption check also lists versions 4, 5 and 9, but its version switch never dispatches those,
so they are unreachable.

## `pf6` and `pf8` index

| Offset | Size | Meaning |
| --- | --- | --- |
| 0x03 | 4 | Index size |
| 0x07 | index size | Index |

The index opens with the entry count and records follow with no padding:

| Field | Size | Meaning |
| --- | --- | --- |
| Name length | 4 | |
| Name | length | CP932 |
| Gap | 4 | Skipped |
| Offset | 4 | Absolute payload offset |
| Size | 4 | |

## `pf2` index

| Offset | Size | Meaning |
| --- | --- | --- |
| 0x03 | 4 | Index size |
| 0x0B | 4 | Entry count |
| 0x07 | index size | Index |

The count lives in the file header rather than in the index, and the index's own records start behind an
eight-byte header. A record has the same shape as above but with a twelve-byte gap between the name and the
payload fields.

## Payload handling

`pf6` and `pf2` payloads are stored as they are. `pf8` payloads are exclusive-ored with the SHA-1 hash of the
whole index block, and the key is indexed by the **absolute** file position, so it does not restart at the
beginning of a payload:

```text
data[i] ^= key[(entry.Offset + i) % key.Length]
```

Because the key is exactly 20 bytes, an entry's unmasking depends on where it sits in the archive.

## Support

| Capability | Status |
| --- | --- |
| `pf` signature and the version digit | Supported |
| `pf6`/`pf8` index layout with the count inside the index | Supported |
| `pf2` layout with the count in the header | Supported |
| Name, gap, offset and size fields for both layouts | Supported |
| Placement checks and hierarchical path normalization | Supported |
| SHA-1 index key and absolute-position unmasking for `pf8` | Supported |
| Alternate UTF-8 name encoding | Unsupported |
| Extension-based entry typing | Unsupported |
| Archive creation | Unsupported |

Synthetic fixtures cover `pf6` with two entries, `pf8` with an encrypted payload, `pf2`, a nested name, an
unknown version digit, a foreign signature, an insane entry count, an index that reaches past the archive, a
name that reaches past the index, a payload outside the archive, and a file too small for its header.
