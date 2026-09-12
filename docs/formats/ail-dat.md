# Ail resource archives

## Reference and attribution

- GARbro references: `ArcFormats/Ail/ArcAil.cs` (class `DatOpener`) and
  `ArcFormats/Ail/ArcLNK2.cs` (class `Lnk2Opener`)
- GARbro tags: `DAT/Ail`, `DAT/LNK2`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015-2018 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

Both variants share one index layout. A list of 32-bit entry sizes is followed by the entry
payloads in index order; a size of zero or `0xffffffff` marks an absent slot. `DAT/Ail` files store
the entry count at offset 0 with the sizes starting at offset 4, while `LNK2` files carry the ASCII
signature `LNK2`, a count at offset 4 that is half the real slot count, and sizes starting at
offset 8. After the last payload the file may contain up to 0x80000 bytes of trailing data.

Entries have no stored names. GARbro generates `<basename>#NNNNN`, then inspects each payload:

- a 16-bit flag of 1 marks an LZSS-compressed entry; the 32-bit unpacked size follows at +2 and the
  compressed stream starts at +6;
- signatures of 0, or `OggS` at offset 4, indicate a four-byte prefix that is skipped;
- otherwise the first six bytes are skipped.

The compressed variant uses the Ail LZSS configuration: a 4 KiB frame pre-filled with 0x20, initial
position 0xfee, and the reversed control-bit polarity (a clear bit is a literal). The first four
decompressed bytes identify the payload type for naming; this port resolves Ogg, WAVE, PNG, BMP and
MPEG video and leaves other payloads with their bare name.

## Support

| Capability | Status |
| --- | --- |
| `DAT/Ail` extension detection | Supported |
| `LNK2` signature detection | Supported |
| Half-count LNK2 slot table | Supported |
| Absent-slot skipping | Supported |
| Ail LZSS decompression | Supported |
| Common signature extension inference | Supported |
| Full GARbro resource-catalog extension inference | Unsupported |
| Archive creation | Unsupported |

Synthetic fixtures cover packed and unpacked entries, reversed-polarity LZSS, type inference, both
count encodings, and the trailing-data limit.
