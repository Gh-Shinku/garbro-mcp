# DDSystem DDP2 resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/DDSystem/ArcDDP.cs` (`Ddp2Opener`) with `Him4Opener.DetectFileTypes` from
  `ArcFormats/SHSystem/ArcHXP.cs`
- GARbro tag: `DDP2`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The signature spells `DDP2`, the entry count sits at 4, and sixteen-byte records follow at 0x20, each holding a
data offset, an unpacked size and a stored size, with four bytes to spare.

Those two size words turn out to be hints rather than the truth. `Him4Opener.DetectFileTypes` re-reads the
sizes from the payload itself, so what extraction follows is the pair stored inside the payload: a stored size
of zero means the data is plain, anything else means it is compressed, and the entry's data begins eight bytes
into the payload either way. The port keeps the index's words as metadata and builds the entry from the payload,
which is the same step the SH System formats share, so that helper and the LZ codec are reused here.

Entries carry generated five-digit names prefixed with the archive's own name. The reference also probes each
payload's first bytes to classify it through its catalog, and the port leaves that out.

## Support

| Capability | Status |
| --- | --- |
| `DDP2` signature and count | Supported |
| Sixteen-byte index records | Supported |
| Payload-driven size pair | Supported |
| Plain and compressed payloads through the shared codec | Supported |
| Index size hints as metadata | Supported |
| Generated names | Supported |
| Type classification by content signature | Not ported |
| Archive creation | Unsupported |

Synthetic fixtures cover a plain and a compressed payload, the sibling signature rejection, and a payload whose
sizes do not describe the file.
