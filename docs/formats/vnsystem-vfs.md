# VNSystem VFS resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/VnSystem/ArcVFS.cs`, class `VfsOpener`
- GARBro tag: `VFS/VNSYSTEM`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The archive starts with the `VFS File` signature, followed by an archive-wide compressed flag and a record count at
0x0C. Index records begin at 0x10 and are 0x1C bytes wide: a 0x14-byte CP932 name, a payload offset relative to the end
of the index, and a stored size. Every entry must pass the reference's placement check.

When the compressed flag is set, each payload begins with a four-byte unpacked size that the reference reads lazily on
extraction; the port reads it while parsing the index so that listing and extraction agree, and it rejects entries whose
stored extent is too small to hold that prefix. Compressed entries are then stored without the prefix.

## Extraction

Uncompressed archives emit plain byte ranges. Compressed entries are decoded by the reference's private bit stream: a
flag bit selects between a literal byte read as eight most-significant-first bits and a back reference, which reads a
unary bit length, steps that far back from the current dictionary position — wrapping once through the 16-byte
dictionary — and emits that byte. Every emitted byte enters the dictionary, which is what allows short repeats, and the
dictionary position wraps with a mask of 0x0F. A back reference that lands outside the dictionary raises the same
invalid-data error as the reference.

The port's bit reader mirrors GARbro's `MsbBitStream`: bits are consumed most-significant first, and reads past the end
return -1 exactly like the reference instead of failing early, so the EOF behaviour of the unary length loop matches.

## Support

| Capability | Status |
| --- | --- |
| `VFS File` signature | Supported |
| Archive-wide compressed flag | Supported |
| 0x1C records with 0x14-byte CP932 names | Supported |
| Index-relative payload offsets | Supported |
| Four-byte unpacked size prefix | Supported |
| MSB bit stream dictionary decoder | Supported |
| Verbatim extraction | Supported |
| Entry placement validation | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the dictionary decoder (a literal followed by a back reference), uncompressed and compressed
archives, a foreign signature, an out-of-range entry and a compressed entry without room for its size prefix.
