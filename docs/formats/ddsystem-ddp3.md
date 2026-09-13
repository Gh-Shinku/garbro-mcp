# DDSystem DDP3 resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/DDSystem/ArcDDP.cs` (`Ddp3Opener`) with `Him5Opener.ReadIndex` and
  `Him4Opener.DetectFileTypes` from `ArcFormats/SHSystem/ArcHXP.cs`
- GARbro tag: `DDP3`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The signature spells `DDP3` and the entry count sits at 4, but the index itself is the one the SH System
version five format uses: `Him5Opener.ReadIndex` reads section descriptors of a size and an offset at 0x20,
skipping any whose size is zero, and each section is then walked until its size runs out.

A section entry begins with its own length, which must be at least seventeen or the walk stops, and holds a
little-endian offset, an unpacked size, a stored size and a name behind them. As in version two the payload's own
size pair is what extraction follows, so the entry's data begins eight bytes into the payload and the sizes the
index carries are kept as metadata. The reference does not reject a blank name here, while the port does, and its
content-signature classification is left out as in the sibling version.

This is the format that motivated porting the SH System helpers: its reader shares both the section descriptor
walk and the LZ codec with that family, and both are imported rather than reimplemented.

## Support

| Capability | Status |
| --- | --- |
| `DDP3` signature and count | Supported |
| Shared section descriptor walk | Supported |
| Section entry walk bounded by the section size | Supported |
| Names from the index with blank rejection | Supported |
| Payload-driven size pair | Supported |
| Plain and compressed payloads through the shared codec | Supported |
| Index size hints as metadata | Supported |
| Type classification by content signature | Not ported |
| Archive creation | Unsupported |

Synthetic fixtures cover a section with a plain and a compressed payload and the sibling signature rejection.
