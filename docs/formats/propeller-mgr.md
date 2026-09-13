# Propeller MGR multi-frame image

## Reference and attribution

- GARBro reference: `ArcFormats/Propeller/ArcMGR.cs`, class `MgrOpener`
- GARBro tag: `MGR`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The format has no signature; the reference only accepts files with an `.mgr` extension. A 16-bit frame count sits at
offset zero and must be between one and 0xFF. Multi-frame archives add a 32-bit offset table whose first entry must
equal the end of the table, and which is used for every frame record; single-frame archives have no table and store
their only record at offset two.

Every frame record starts with the unpacked size and the stored size, then the compressed bitmap. The reference probes
the record for a `BM` marker nine bytes in — that is, two bytes into the stored stream — requires an unpacked size of at
least 0x36 bytes, and checks that the stored size fits inside the file from the record offset. Frames are named
`<base>#<index>.bmp` with a four-digit index, while single-frame archives reuse the source name with `.bmp` appended.
All entries are typed as images.

## Extraction

GARbro's decoder reads control bytes below 0x20 as a literal run of `control + 1` bytes and anything else as a back
reference: the low five bits shifted left by eight plus one form the distance, and the top three bits plus two form the
length, with a top value of seven extending the length by one further byte. Copies may overlap the output position. A
reference that would reach past the start of the output raises the same invalid-archive error as the reference, and the
output buffer is always exactly the declared unpacked size, so the size is treated as exact.

## Support

| Capability | Status |
| --- | --- |
| `.mgr` extension requirement | Supported |
| 16-bit frame count | Supported |
| Multi-frame offset table with first-entry check | Supported |
| Single-frame layout | Supported |
| `BM` marker probe | Supported |
| Frame header with unpacked and stored sizes | Supported |
| Propeller back-reference decoder | Supported |
| `<base>#<index>.bmp` naming | Supported |
| Image typing | Supported |
| Entry placement validation | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the decoder (a literal run and a back reference), a two-frame archive, a single-frame archive,
the extension requirement, a mismatched first offset, a missing bitmap marker and an undersized frame.
