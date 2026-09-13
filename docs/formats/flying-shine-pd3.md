# Flying Shine PD version 3 resource archive

Reference: `GARbro/ArcFormats/FlyingShine/ArcPD.cs`, class `Pd3Opener`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/flying-shine/pd.ts` (`flyingShinePd3Descriptor`,
`flyingShinePd3Format`, id `flying-shine-pd3`).

The reference file also holds `PdOpener` (`PD`) and `FlyingShinePdOpener` (`PD/2`); those tags are
separate implementations and are not covered here.

## Header and index

| Offset | Size | Meaning |
|--------|------|---------|
| `0x00` | 4 | index record count (`i32`) |
| `0x04` | 4 | entry count (`i32`) |
| `0x08` | 4 | unused |
| `0x0C` | 4 | payload size (`u32`) |
| `0x18` | 0x11C × index count | index records |
| `0x18 + 0x11C × index count` | payload size | payload area |

The header has no signature, so detection is the parse itself. The gates are: `indexCount >= count`
with both counts sane, an index that leaves room behind the header
(`0x11C × indexCount < fileSize − 0x18`), and `baseOffset + totalSize == fileSize`, where
`baseOffset = 0x18 + 0x11C × indexCount`. The index size multiplication wraps in 32 bits like the
reference's `uint` arithmetic.

## Records

Every record is `0x11C` bytes: a NUL terminated cp932 name in the first `0x104` bytes, the size at
`0x108` (`u32`) and the payload offset relative to `baseOffset` at `0x10C` (`u32`). A record whose
**first byte is zero** is an empty slot and is skipped, which is how GARbro represents holes; a file
whose records are all empty is declined, as is any entry failing `checkPlacement`.

## Extraction

Entries whose name ends in `.def` or `.dsf` (case insensitive) store every byte rotated right by four
bits, so they are un-rotated on extraction; this is a length preserving transform, hence `sizeKnown`
stays true. All other entries are extracted verbatim.

## Deviations

* Archive creation (`PdOpener.Create` in the same reference file) is out of scope, as is the
  `PackPlusArchive` variant of the `PD` tag.
* The index is read as one block behind the fixed header instead of through the file view.
