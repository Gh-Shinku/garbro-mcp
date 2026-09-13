# KAG System XPK archive

## Reference and attribution

- GARBro reference: `ArcFormats/KiriKiri/ArcXPK.cs` (varint helper from `Xp3Opener.ReadUInt`), class `XpkOpener`
- GARBro tag: `XPK`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

Archives that start with `XPK1\x1a` hold a count at 0x0a and a flat record list. Every integer in
the record list is a size-prefixed big-endian value: GARbro reads one byte that must equal 4 and
then a 32-bit big-endian number.

A record stores the data offset, the stored size, the declared unpacked size, two unused bytes, and
a null-terminated CP932 name. GARbro accepts an entry that starts exactly at the end of the file
with a zero size, which is how empty trailing records are represented.

GARbro also searches for the signature inside PE executables. That path depends on GARbro's EXE
section reader and is not part of this port.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| Size-prefixed big-endian integers | Supported |
| Null-terminated CP932 names | Supported |
| Zero-length trailing entry | Supported |
| Entry placement validation | Supported |
| Entry listing and extraction | Supported |
| Executable-embedded archives | Unsupported |
| Archive creation | Unsupported |

Synthetic fixtures cover the record layout, CP932 names, the empty trailing entry, varint rejection,
and entry placement rejection.
