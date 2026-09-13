# Riddle Soft PAC1 resource archive

GARBro reference: `ArcFormats/RiddleSoft/ArcPAC.cs`, class `PacOpener` (tag `PAC1`, MIT).

`PAC1` archives contain a count followed by 0x20-byte CP932 index records. Payloads are stored sequentially after
the index rather than carrying individual offsets. Each record contains the stored size at `+0x10`; `.scp` records
whose `+0x14` field is `CMP1` also declare their unpacked size at `+0x18`.

Extraction rechecks the payload's `CMP1` marker, skips its 12-byte header, and decodes the remaining MSB-first Riddle
LZSS bitstream. Other entries are exposed verbatim. Synthetic fixtures cover stored data, packed scripts, marker
semantics, signature-based detection, and sequential payload bounds; archive creation is not supported.
