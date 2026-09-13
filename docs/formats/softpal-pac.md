# Softpal PAC resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/Softpal/ArcPAC.cs`, class `PacOpener`
- GARbro tag: `PAC/SOFTPAL`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The entry count sits at 0 and the index at 0x3FE. A record is a fixed-width name field, the stored size, and
the data offset, and the name field width is not recorded: the reference tries a wide 0x20-byte field and
then a narrow 0x10-byte one, accepting a candidate only when the first record's offset word equals the end
of the index. The port reproduces that ordering and that check, and a file must at least be large enough for
the narrowest candidate. The format carries no signature, so the `pac` extension and the alignment check
together are the detection.

## Payload transform

`OpenEntry` leaves a payload alone unless the entry is not classified as an image or audio file, its size
exceeds sixteen bytes, and its first byte is `$`. Otherwise every full 32-bit word behind a sixteen-byte
prefix has its first byte — the low byte in little-endian order — rotated left by a shift starting at four
and growing by one per word, and the word is then exclusive-ored with a fixed constant. The first sixteen
bytes pass through untouched, and the port records whether the transform applies as entry metadata.

The reference decides the image and audio cases from its resource catalog; the port approximates them with
an extension set.

## Support

| Capability | Status |
| --- | --- |
| `pac` extension requirement | Supported |
| Entry count validation | Supported |
| Wide and narrow name fields with first-match ordering | Supported |
| First-offset alignment check | Supported |
| Index bound and entry placement validation | Supported |
| CP932 names with blank rejection | Supported |
| `$`-marked payload transform behind a sixteen-byte prefix | Supported |
| Image and audio exemption from the transform | Supported as an extension set |
| Archive creation | Unsupported |

Synthetic fixtures cover both name widths, a transformed payload, the extension requirement, and the Amuse
sibling variant in its own note.
