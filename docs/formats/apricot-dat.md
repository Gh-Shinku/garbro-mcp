# Apricot resource archives (DAT/MPF2)

## Reference and attribution

- GARBro reference: `ArcFormats/Apricot/ArcDAT.cs`, class `Mpf2Opener`
- GARBro tag: `DAT/MPF2`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The archive opens with an `MPF2` signature, and its payload offsets address a **virtual** space that continues
through sibling parts, so entries may span a part boundary.

## Header and index

| Offset | Size | Meaning |
| --- | --- | --- |
| 0x00 | 4 | `MPF2` signature |
| 0x08 | 4 | Compressed index length |
| 0x10 | 4 | Payload base offset |
| 0x20 | … | zlib-compressed index |

The index occupies the declared length behind the header and unpacks to the record sequence; the uncompressed
length is not stored, so the stream is decoded to its end. A length that does not fit the file, and an index that
is not a zlib stream, decline the archive.

## Records

```
[i32 entry length] [u32 deleted] [i64 offset] [u32 unused]
[u32 stored size] [u32 unpacked size] [500 skipped bytes] [UTF-16LE name]
```

`entry length` covers the whole record, so the name occupies the bytes behind the fixed 528-byte header. A record
that cannot hold a name — an entry length of 528 or less — declines the whole index.

The payload offset is a 64-bit value **relative to the header's payload base**. An entry is packed when its
stored size differs from its unpacked size, and packed payloads are zlib streams. The walk ends with the index
itself, so a truncated final record yields only the bytes that exist, which can be an empty name.

Two kinds of records are silently skipped rather than declining the archive, exactly like the reference:

- records whose deleted flag is set, which still consume their own length;
- records whose payload does not fit the virtual file space.

Names are UTF-16LE and hierarchical, so backslashes become forward slashes and the original name is kept as
`rawPath`.

## Virtual file space

The archive comes first and the parts continue it, for up to ninety-nine parts named `<archive>.a01` through
`<archive>.a99`; the reference stops collecting at the first missing one. Payload ranges are read across that
space, so an entry that starts near the end of one file and continues into the next one is returned whole. This
uses the shared multi-part reader, which mirrors `MultiFileArchive.OpenStream`.

## Support

| Capability | Status |
| --- | --- |
| `MPF2` signature, index length and payload base | Supported |
| zlib index decoded to its end | Supported |
| Record walk driven by the record's own length | Supported |
| Deleted records skipped but still consuming their length | Supported |
| Records outside the virtual space skipped | Supported |
| Relative 64-bit payload offsets and packed and unpacked sizes | Supported |
| zlib payload decoding | Supported |
| UTF-16LE hierarchical names | Supported |
| Virtual offset space across `.a01` to `.a99` parts | Supported |
| Payloads that span a part boundary | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover stored and packed entries with a hierarchical name, a deleted record, an unreachable
record, an empty index, a payload read from a part and one that spans the part boundary, a record without a name,
an index length outside the file, an index that is not a zlib stream, and a wrong signature.
