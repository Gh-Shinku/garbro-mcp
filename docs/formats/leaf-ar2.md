# Leaf ar21 resource archives

## Reference and attribution

- GARBro reference: `ArcFormats/Leaf/ArcAR2.cs`, class `Ar2Opener`
- GARBro tag: `AR2`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Signature and index

`ar21` marks the format, followed by a 32-bit entry count at 0x04 that has to be sane. Records are walked
sequentially from 0x08 and have no fixed stride:

| Field | Size | Meaning |
| --- | --- | --- |
| Name length | 1 | In UTF-16 code units |
| Name | length × 2 | UTF-16, low bytes masked |
| Offset | 4 | Relative to the end of the whole index |
| Size | 4 | Stored size |
| Key | 1 | Key table row |

Stored names are UTF-16, but **the low byte of every code unit is exclusive-ored with the code unit
count**, so a name has to be unmasked before it is decoded. Offsets cannot be rebased while the walk is in
progress, because they are relative to the end of the index; the reference therefore reads the whole index
first and adds its size to every offset afterwards.

## Payload handling

Every payload is exclusive-ored with a 512-byte key table. The record's key byte selects the row and the
low byte of the payload position selects the column, so the table index never leaves the table:

```text
data[i] ^= key_table[key + (i & 0xFF)]
```

No compression is involved, so the stored size is also the extracted size.

## Support

| Capability | Status |
| --- | --- |
| `ar21` signature and the entry count | Supported |
| Byte name lengths and variable-length records | Supported |
| UTF-16 names with masked low bytes | Supported |
| Per-record key bytes and offsets relative to the index end | Supported |
| Placement checks and hierarchical path normalization | Supported |
| Payload exclusive-or with the key table | Supported |
| Extension-based entry typing | Unsupported |
| Archive creation | Unsupported |

Synthetic fixtures cover a two-entry archive with different keys, a non-ASCII UTF-16 name, a name with
backslash separators, a payload longer than 256 bytes that exercises the second key table row, a foreign
signature, an insane entry count, a record that reaches past the archive, a payload outside the archive,
and a file too small for its header.
