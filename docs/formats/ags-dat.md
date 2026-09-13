# AnimeGameSystem DAT resource archives

## Reference and attribution

- GARBro reference: `ArcFormats/AnimeGameSystem/ArcDAT.cs`, class `DatOpener`
- GARBro tag: `DAT/AGS`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- Extensions: `dat`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Index

The archive starts with the `pack` marker and a 16-bit entry count at 0x04. Fixed records follow from 0x06:

| Offset | Size | Meaning |
| --- | --- | --- |
| 0x00 | 0x10 | CP932 name, read up to the first null byte |
| 0x10 | 4 | Payload offset |
| 0x14 | 4 | Stored size |

The whole index has to fit, every entry is placement-checked, and the payloads are stored as they are. Names that
contain backslashes become forward-slash paths, the toolkit's canonical separator.

GARbro decrypts archives whose file name appears in its user scheme's encrypted list, using a key from the same scheme;
the built-in default scheme leaves both empty, which is the behavior the port implements. Key data for encrypted
archives therefore lives in user configuration rather than in the reference sources, and is out of scope.

## Support

| Capability | Status |
| --- | --- |
| `pack` marker and entry count | Supported |
| Fixed 0x18 index records | Supported |
| Sixteen byte CP932 name fields | Supported |
| Payload offsets, stored sizes and placement checks | Supported |
| Index reservation check | Supported |
| Raw payload extraction | Supported |
| Archives encrypted through user schemes | Unsupported |
| Extension-based entry typing | Unsupported |
| Archive creation | Unsupported |

Synthetic fixtures cover a two-entry archive, a backslash path, a padded name field, a foreign signature, an insane
entry count, an index that reaches past the archive, an entry outside the archive, an entry size past the archive, and a
file too small for its header.
