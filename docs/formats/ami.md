# Amaterasu AMI

## Reference and attribution

- GARBro reference: `ArcFormats/Amaterasu/ArcAMI.cs`, class `AmiOpener`
- GARBro tag: `AMI`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2014 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

An AMI archive starts with `AMI\0`, a little-endian entry count, and the data-section offset. Each
16-byte index record stores a numeric resource ID, absolute data offset, unpacked size, and packed
size. A zero packed size identifies a raw entry; a nonzero packed size identifies zlib data.

GARbro synthesizes filenames from the eight-digit lowercase hexadecimal resource ID. Packed entries
use `.grp`. Raw `SCR\0` and `GRP\0` signatures select `.scr` and `.grp`; other raw data uses `.dat`.

## Support

| Capability | Status |
| --- | --- |
| Signature and structural detection | Supported |
| Synthetic hexadecimal filenames | Supported |
| SCR/GRP/DAT extension inference | Supported |
| Raw entry extraction | Supported |
| Zlib-compressed GRP extraction | Supported |
| Archive creation and base-archive updates | Unsupported |

The implementation is covered by synthetic raw and compressed entries plus malformed-placement
tests. It has not been validated against real game data, following the current migration policy.
