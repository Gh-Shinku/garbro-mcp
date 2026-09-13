# 'Unknown' DAT resource archive

## Reference and attribution

- GARbro reference: `Legacy/Unknown/ArcDAT.cs`, class `DatOpener`
- GARBro tag: `DAT/UNKNOWN`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2010-2017 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The format has no signature. The header holds a signed entry count at 0, a record stride at 4, and the payload offset
at 8. GARbro requires a sane count, a stride between one and 0x10, and an index that ends exactly where the payload
starts. The port additionally requires the stride to be at least 12 bytes so each record's id, size and offset words
fit inside the index.

The index bytes are nibble-swapped (`Binary.RotByteR (byte, 4)`) before use. Each record holds a signed id at 0, the
payload size at 4, and the payload offset at 8. Every offset must sit at or behind the payload start and inside the
file. Entries are named `<archive>#<id padded to 4>`.

## Extraction

`DatOpener.OpenEntry` reads the payload and nibble-swaps it before returning it, so both the index and the payloads are
encoded with the same self-inverse rotation.

GARbro's `DetectFileTypes` classifies entries through the resource catalog; that inference is not reproduced.

## Support

| Capability | Status |
| --- | --- |
| Header with count, stride and payload offset | Supported |
| Stride bounds of 12 to 0x10 | Supported |
| Nibble-rotated index | Supported |
| Derived `<archive>#<id>` names | Supported |
| Payload placement validation | Supported |
| Nibble-rotated payload extraction | Supported |
| Entry type inference | Unsupported |
| Archive creation | Unsupported |

Synthetic fixtures cover two decrypted entries and rejection of an index that does not meet the payload area, an offset
in front of it, and an oversized record stride.
