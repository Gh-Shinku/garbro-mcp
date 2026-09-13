# ClickTeam MFS resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/ClickTeam/ArcMF.cs`, class `MfOpener`
- Executable overlay helper: `ArcFormats/ExeFile.cs`, `ExeFile.InitSectionTable` / `ExeFile.InitNe`
- GARBro tag: `MFS`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The archive starts either at the beginning of a plain file or behind the last section of a Windows executable. The
eight-byte marker `77 77 77 77 49 87 47 12` must be present, the entry count is an int32 at 0x1C, and the index begins at
0x20.

Every record is laid out as:

| Offset | Size | Meaning |
| --- | --- | --- |
| 0x00 | 2 | Name length in UTF-16 code units |
| 0x02 | 2 × length | UTF-16 name |
| — | 4 | Reserved words |
| — | 4 | Stored size |
| — | size | Payload |

Because each record is followed directly by its payload, the walk doubles as the payload table: the next record begins
after the current payload. Entries are deflated except the `mmfs2.dll` library, which is stored raw, and every entry has
to pass the placement check.

The reference registers the `wwww` signature and an empty extension; detection is driven by the marker for plain files
and by the overlay lookup for executables.

## Executable overlay lookup

For a file that starts with `MZ`, the overlay offset comes from the shared `shared/exe.ts` helper, which ports
`ExeFile.InitSectionTable` and `ExeFile.InitNe`:

- A 16-bit NE image reports the end of its last segment.
- A 32-bit PE image starts from `SizeOfHeaders`, takes the end of the last section that occupies file space, rounds the
  result up to a paragraph boundary and clamps it to the file length.
- Headers that do not parse — an out-of-range PE pointer or a missing `PE\0\0` — make detection fail, mirroring the
  invalid-format exception the reference raises.

## Support

| Capability | Status |
| --- | --- |
| `wwww` marker with reserved bytes | Supported |
| Executable overlay lookup (MZ/PE32 and NE) | Supported |
| Entry count | Supported |
| UTF-16 names with code-unit lengths | Supported |
| Reserved words, size field and record walk | Supported |
| zlib payloads except `mmfs2.dll` | Supported |
| Entry placement validation | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover a deflated archive with a stored library, an archive behind a PE overlay, a file without the
marker, an out-of-range payload and an executable whose header pointer leaves no room for a PE header.
