# Youkai Tamanokoshi resource archives (DAT)

## Reference and attribution

- GARBro reference: `ArcFormats/Youkai/ArcDAT.cs` — classes `GrpDatOpener`, `SoundDatOpener`, `VoiceDatOpener`
- GARBro tags: `DAT/YOUKAI/1`, `DAT/YOUKAI/2`, `DAT/YOUKAI/3`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

All three layouts are plain index and payload containers that carry no signature and are gated only by the `.dat`
extension and by their structure, so the port checks the extension in every detector and registers no signature
hints. Names are CP932 fields of 0x100 bytes whose cursor advances by the whole field; an empty name rejects the
layout. Names are not hierarchical, so they are listed verbatim.

## `DAT/YOUKAI/1` — group archive

| Offset | Size | Meaning |
| --- | --- | --- |
| 0x00 | 4 | Entry count |
| 0x04 | 4 | Zero |
| 0x20 | … | Index records of 0x110 bytes |

A record holds a 0x100-byte name, a 32-bit stored size at +0x100 and a 32-bit payload offset at +0x104. The
payload area starts at `0x20 + count × 0x110` and must lie inside the file; every payload must start behind the
index and fit the file.

A payload that begins with `ACMPRS03` is an LZSS stream: the packed size stands at +0x14 and the stream starts at
+0x24. The reference decides that when an entry is opened; the port additionally probes each payload while
listing, so packed entries are reported as compressed with an unknown unpacked size. Any other payload is
stored.

## `DAT/YOUKAI/2` — sound bank

The file opens with a 32-bit entry count and then alternates records with payloads: a 0x100-byte name, a 32-bit
stored size, and then the payload itself directly behind the record. The walk must end **exactly** at the end of
the file, so trailing bytes reject the layout. Payloads are stored.

## `DAT/YOUKAI/3` — voice bank

| Offset | Size | Meaning |
| --- | --- | --- |
| 0x00 | 4 | Data offset |
| 0x04 | 4 | Entry count |
| 0x08 | … | Index records of 0x108 bytes |

Records hold a 0x100-byte name, a 32-bit stored size at +0x100 and a 32-bit payload offset at +0x104. The index
`0x08 + count × 0x108` must end before the data offset. Unlike the group layout the reference does not require a
payload to start behind the index, only that it fits the file, and the port mirrors that.

## Support

| Capability | Status |
| --- | --- |
| `.dat` extension gate for all three layouts | Supported |
| Group archive header, fixed-stride index and payload area check | Supported |
| `ACMPRS03` LZSS payloads with a packed size at +0x14 | Supported |
| Alternating record and payload layout with an exact file end | Supported |
| Voice data offset, index bound and payload table | Supported |
| Placement checks for every payload | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover stored and packed group payloads, a payload too short to carry the packed magic, a
non-zero word behind the group count, a group payload inside the index, an empty name, a non-`.dat` name, a sound
bank with two records, trailing bytes behind a sound bank, a sound payload past the file, a voice bank with two
records, a voice index that reaches into the data area, and a voice payload past the file.
