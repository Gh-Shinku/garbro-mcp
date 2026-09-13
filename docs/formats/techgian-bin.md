# Tech Gian RFIL archive

## Reference and attribution

- GARBro reference: `ArcFormats/TechGian/ArcBIN.cs`, classes `BinOpener` and `RfilEntry`
- GARBro tag: `BIN/RFIL`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

An `RFIL` archive keeps its record count at 8 and a second word at 12. When that word equals `1234`
the whole index is XORed with a C runtime random stream: GARbro seeds `CRuntimeRandomGenerator` with
zero and draws one value per index byte, so the port reproduces the Microsoft C runtime linear
congruential generator (`seed * 214013 + 2531011`, taking bits 16..30).

Each 0x40-byte record holds a 0x30-byte CP932 name, an offset at 0x34, a size at 0x38, and a payload
encryption method at 0x3C. Extraction applies the key only to methods `1`, `2`, and `4`, which XOR the
payload with 0x7F in full, to one byte per hundred plus one, or to at most the first kilobyte
respectively. Every other method, including zero, is extracted verbatim, and the method plus the
index flag are exposed as entry metadata.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| Record count validation | Supported |
| Index decryption (`CRuntimeRandomGenerator`, seed 0) | Supported |
| CP932 filenames | Supported |
| Entry placement validation | Supported |
| Entry listing | Supported |
| Full payload key (method 1) | Supported |
| Partial payload key (methods 2 and 4) | Supported |
| Verbatim extraction for other methods | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover a plain index, an encrypted index, both partial-key limits, and signature
rejection.
