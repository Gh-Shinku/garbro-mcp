# Aoi VFS resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/Aoi/ArcVFS.cs`, class `VfsOpener`
- GARbro tag: `VFS/AOI`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The archive needs a `vfs` extension and begins with one of two signature words — `FV` or `VL` as values, which
appear in byte order as `VF` and `VL` — followed by a version, the entry count, the record stride and an index
size, while the word at 0xC must equal the file's own length. A stride or index size of zero or less rejects the
file, and the count is the only sanity check the reference applies.

Versions below 0x0200 keep each entry's name in a 0x13-byte field inside its own record, followed by the data
offset, the stored size, an unpacked size and a packed flag. The stride is announced by the header rather than
derived, so a record wider than its fields is normal, and the port reads the fields it knows and steps by the
announced stride.

Versions from 0x0200 onward replace the in-record name with a character index into a UTF-16 pool that trails the
records. That pool begins with a character count, and the reference skips four bytes behind the count before
reading the text, so the names start eight bytes into the pool block. An index outside the pool rejects the
archive, as does an empty name.

Neither version installs an entry decoder in the reference, so payloads are emitted verbatim and the packed flag
is kept as metadata — a hint for the image and audio layers rather than something the archive layer acts on.

## Support

| Capability | Status |
| --- | --- |
| Both signatures with the file length cross-check | Supported |
| Version, count, stride and index size validation | Supported |
| Version one records with in-record names | Supported |
| Announced stride honoured beyond the field widths | Supported |
| Version two records with a UTF-16 name pool | Supported |
| Pool header skipping and character index validation | Supported |
| Entry placement validation | Supported |
| Packed flag exposed as metadata | Supported |
| Verbatim extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover a version one archive, a version two archive with its pool, a foreign signature, a
mismatched file length, and the extension requirement.
