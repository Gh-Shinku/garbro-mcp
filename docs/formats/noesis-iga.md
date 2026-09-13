# Noesis IGA resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/Noesis/ArcIGA.cs`, class `IgaOpener`
- GARBro tag: `IGA`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2019 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

An `IGA0` archive stores the index length as a packed integer at 0x10. Records follow with packed
name offsets, data offsets, and sizes, then a packed length sizes the name blob; data offsets are
relative to the end of that blob. Names are stored as one packed integer per CP932 character.

GARbro's packed integers accumulate seven-bit groups until the running value turns odd and then shift
the result right by one, which means the encoder must leave every non-final digit even. The port
reproduces that decoder exactly, so names whose bytes cannot satisfy the constraint stay undecodable,
as in the reference implementation.

Payloads are transformed on extraction: every byte is XORed with its position plus two, and `*.s`
scripts use an additional 0xff key.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| Packed integer index and name blob | Supported |
| Packed per-character names | Supported |
| Position-dependent payload XOR | Supported |
| `*.s` script key | Supported |
| Entry placement validation | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Values outside the reference packed-integer range | Unsupported |
| Archive creation | Unsupported |

Synthetic fixtures cover the packed index, the name blob, both payload transforms, and signature
rejection.
