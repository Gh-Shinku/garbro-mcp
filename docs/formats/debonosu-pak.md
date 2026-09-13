# Debonosu Works PAK resource archives

## Reference and attribution

- GARBro reference: `ArcFormats/Debonosu/ArcPAK.cs`, class `PakOpener`
- GARBro tag: `PAK/Debonosu`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- Extensions: `pak`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Header and index

The archive starts with the `PAK\0` marker, a 16-bit index offset at 0x04, and a word at 0x0A that has to be zero. The
index header sits at that offset:

| Offset | Size | Meaning |
| --- | --- | --- |
| 0x00 | 4 | Info block size |
| 0x08 | 4 | Root record count |
| 0x0C | 4 | Unpacked index size |
| 0x10 | 4 | Packed index size |

The packed index follows the info block, and it is a **raw deflate** stream — .NET's `DeflateStream`, so there is no
zlib wrapper. Payload offsets are relative to the end of the packed index.

The unpacked index is a sequence of records, each of which is three 64-bit sizes, a flags word, three 64-bit
timestamps, and a null-terminated CP932 name:

| Field | Meaning for an entry | Meaning for a directory |
| --- | --- | --- |
| First size | Payload offset, relative to the packed index end | Unused |
| Second size | Unpacked size | Child count |
| Third size | Stored size | Unused |
| Flags | 0 | `0x10` marks a directory |

Directory names are prefixes of their children's paths, so the walk recurses and combines names with a backslash.
Flag bits other than `0x10` are ignored, as in the reference.

The reference reads records without checking that the index still has bytes, which ends the walk with an exception that
rejects the archive, and casts both sizes to 32 bits. The port checks the same bounds directly, keeps the 32-bit wrap,
and caps the directory recursion depth so a hostile index cannot exhaust the stack.

## Extraction

Every entry is a raw deflate stream, so extraction inflates the stored range with the raw counterpart of the zlib
decoder. The stored size is the third record size and the unpacked size the second, and both are reported separately.

## Support

| Capability | Status |
| --- | --- |
| `PAK` marker, index offset and zero word | Supported |
| Index header with the info size and root count | Supported |
| Raw deflate packed index | Supported |
| Entry and directory records with timestamps | Supported |
| Recursive path prefixes | Supported |
| CP932 null-terminated names | Supported |
| Raw deflate payload extraction | Supported |
| Index bounds checks and a depth limit | Supported |
| Extension-based entry typing | Unsupported |
| Archive creation | Unsupported |

Synthetic fixtures cover a flat index, nested directories, the separate unpacked and stored sizes, a foreign signature,
a set second header word, an empty root directory, a packed index past the archive, an index that is not a deflate
stream, a directory whose child count overruns the index, an entry outside the archive, and a directory tree deeper
than the port allows.
