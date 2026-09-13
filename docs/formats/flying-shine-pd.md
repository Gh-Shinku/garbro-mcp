# Flying Shine PD resource archive

Reference: `GARbro/ArcFormats/FlyingShine/ArcPD.cs`, class `PdOpener`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/flying-shine/pd-legacy.ts` (`flyingShinePdDescriptor`,
`flyingShinePdFormat`, id `flying-shine-pd`).

The reference file also holds `FlyingShinePdOpener` (`PD/2`) and `Pd3Opener` (`PD/3`); those tags are
separate implementations.

## Header and records

| Offset | Size | Meaning |
|--------|------|---------|
| `0x00` | 4 | `Pack` |
| `0x04` | 4 | variant word: `Only` (plain) or `Plus` (masked) |
| `0x08` … `0x3F` | | unused by the reader |
| `0x40` | 4 | entry count (`i32`) |
| `0x48` | 0x90 × count | records |
| `0x48 + 0x90 × count` | | payload area |

The signature is the little endian spelling of `Pack`, so the registry gates on those four bytes; the
variant word must then be `Only` (`0x796C6E4F`) or `Plus` (`0x73756C50`), the count must pass
`IsSaneCount`, and the record table must leave room (`count × 0x90 < fileSize`). A variant word that
is neither declines the archive.

Every record holds a NUL terminated cp932 name in the first `0x80` bytes, a **signed 64 bit** payload
offset at `0x80` and a `u32` size at `0x88`; each entry passes `checkPlacement`. Names ending in
`.dsf` are reported with `type: "script"` in their metadata, matching the reference's
`entry.Type = "script"`.

## Extraction

`Only` archives store their payloads verbatim. In `Plus` archives every payload byte is masked with
`0xFF`, which `openEntry` reproduces; because the mask is length preserving, `sizeKnown` stays true
and the archive metadata records `masked: true`. The reference keeps this flag on the archive
(`PackPlusArchive`), which the port mirrors by marking every entry `encrypted`.

## Deviations

* Archive creation is out of scope (`PdOpener.Create`, including the `PDScrambleContents` option and
  the `CreatePDWidget` dialog).
* The `PD/2` and `PD/3` tags live in the same reference file but are separate status records; only the
  `PD` tag is covered here.
