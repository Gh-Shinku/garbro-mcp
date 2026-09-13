# origin engine DAT/HED resource archive

Reference: `GARbro/ArcFormats/Origin/ArcDAT.cs`, class `HedDatOpener` (the listing; `OrgImageDecoder`
is out of scope)
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/origin/dat-hed.ts` (`originHedDatDescriptor`,
`originHedDatFormat`, id `origin-dat-hed`).

Detection needs a companion pair: the payload file must be named `*.dat` and a sibling file with the
same base name and the `HED` extension must exist next to it. The `.hed` file is the index, so the
`.dat` file is only read for the type probes and the sizes.

## Index

The `.hed` file is a flat loop of records until its end:

| Size | Meaning |
|------|---------|
| 1 | name field length (`u8`); zero means a generated name |
| length | name bytes, each masked with `0xFF`; a C string inside the field |
| 4 | payload offset (`u32`, relative to the `.dat` file) |

A name field of zero generates `<base>#<index:04>` from the data file name; names are decoded as
cp932 after unmasking. An offset behind the end of the data file declines the archive, as does an
index without a single record or a truncated record.

## Sizes and types

Sizes are not stored: every entry spans up to the next offset and the last one runs to the end of the
file, so the entries follow the index order. A wrapped (negative) distance fails the placement check
and declines the archive.

Each payload is then probed with `0x11` bytes (zero filled when the payload is shorter):

* `OggS` at offset `0xD` marks an audio entry; the offset advances by `0xD` and the size shrinks by the
  same amount, so the entry addresses the stream itself.
* Otherwise, when the data file is named `MASK.DAT` (compared case insensitively) every entry is an
  image; elsewhere an image needs a first byte of at most one and a method byte between one and three.

Image entries carry the header the reference reads when decoding: for `MASK.DAT` the width and height
from two `u32` words with `bpp: 8` and `isMask: true`, otherwise `hasAlpha` and `method` from the
first two bytes, `u16` width at offset 2, `u16` height at offset 4 and `bpp: 32`.

## Deviations

* `OrgImageDecoder` (palette reading and the packed image modes) is out of scope, so image payloads
  are extracted as stored while the entry sizes follow the index.
* The companion lookup tries `HED` first and falls back to the lower case spelling, because the
  reference resolves it through GARbro's virtual file system, which is case insensitive.
* The type probe is read clamped and zero filled instead of through the file view, where a short read
  would leave the previous probe's bytes in the buffer.
