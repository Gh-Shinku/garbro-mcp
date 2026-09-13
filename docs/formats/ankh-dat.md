# Ankh DAT resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/Ankh/ArcDAT.cs`, class `DatOpener`
- Inherited behavior: `GrpOpener` payload detection and entry opener in `ArcFormats/Ankh/ArcGRP.cs`
- GARBro tag: `DAT/ANKH`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The file has to carry the `.dat` extension. The entry count is an int32 at 0x00 and the word at 0x14 has to be exactly
where an index of 0x14-byte records ends.

Every index record is:

| Offset | Size | Meaning |
| --- | --- | --- |
| 0x00 | 0x0C | Name, read up to its first zero byte and rejected when empty |
| 0x0C | 4 | Stored size |
| 0x10 | 4 | Payload offset |

Entries keep their stored names — unlike the Ice archive, which derives names from the file name — and every placement is
validated.

## Shared behavior

The opener inherits the Ice archive's payload detection pass and entry opener unchanged, so folded and stored TPW
payloads, HDJ and zfd containers, inline Ogg and RIFF payloads, packed samples and the type/extension retyping all behave
as documented in [ankh-grp.md](ankh-grp.md). Retyping uses `Path.ChangeExtension` semantics, so a detected bitmap renames
`IMAGE.BIN` to `IMAGE.bmp`.

## Support

| Capability | Status |
| --- | --- |
| `.dat` extension check | Supported |
| Entry count and first-offset check | Supported |
| 0x14 records with names, sizes and payload offsets | Supported |
| Empty-name rejection | Supported |
| Inherited payload detection and extraction | Supported |
| TPW, HDJ and zfd containers | Supported |
| Inline Ogg and RIFF payloads and packed samples | Supported |
| Type and extension retyping | Supported |
| Entry placement validation | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover named entries, a folded TPW payload and an inline LZSS payload resolved through the inherited
code paths, a file without the `.dat` extension, a wrong first offset, an empty name and an out-of-range payload.
