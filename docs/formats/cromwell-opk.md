# cromwell OPK audio archive

## Reference and attribution

- GARBro reference: `ArcFormats/Cromwell/ArcPAK.cs`, class `OpkOpener`
- GARBro tag: `OPK`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The archive starts with the `VoiceOggPackFile` signature, followed by a record count at 0x10 and an offset table of
`count + 1` words at 0x14. Each entry spans from its own word to the next one, and the reference rejects any pair whose
difference would not fit inside the file, which also covers descending offsets.

The final table word is the position of the name table. Names follow one another as 8-byte C strings — decoded with
CP932 and terminated by the first NUL — and each receives an `.ogg` extension. The port requires the whole name table to
be present, so an archive whose last offset points at a truncated table is rejected rather than listing entries with
empty names.

## Extraction

Every entry is stored verbatim; the reference does not override `OpenEntry` and relies on the base class for raw
ranges. Entries are typed as audio.

## Support

| Capability | Status |
| --- | --- |
| `VoiceOggPackFile` signature | Supported |
| Record count at 0x10 | Supported |
| `count + 1` offset table | Supported |
| Next-offset extents | Supported |
| Audio typing | Supported |
| 8-byte C string names with `.ogg` extension | Supported |
| Verbatim extraction | Supported |
| Entry placement validation | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover a two-entry archive, audio typing, a foreign signature, descending offsets and a truncated name
table.
