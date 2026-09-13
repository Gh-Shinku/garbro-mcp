# Paprika PK DAT resource archive

## Reference and attribution

- GARBro reference: `Legacy/Paprika/ArcPKDAT.cs`, class `PkDatOpener`
- GARBro tag: `DAT/PAPRIKA`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

An archive is one numbered slice of a shared `SCNPK.DAT` index that lives beside it. GARbro selects
the index slot from the archive name: it must start with `PICPK`, `AVIPK`, `MUSPK`, or `WAVPK`, whose
position in that list is the slot number, and it must end with a digit that identifies the slice.

The word at the slot points at a record list of nine-byte entries: a slice number, a data offset, and
the stored size. Only records whose number matches the archive's digit are kept, and GARbro stops
once the offsets stop increasing. Entries are named from their position in the shared list, padded to
four digits, with the archive name's first three characters as the extension.

## Support

| Capability | Status |
| --- | --- |
| Companion `SCNPK.DAT` index | Supported |
| Prefix-selected index slots | Supported |
| Slice-number filtering | Supported |
| Position-derived entry names | Supported |
| Non-increasing offset stop | Supported |
| Entry placement validation | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover slice selection, position-derived names, name validation, and
missing-companion rejection.
