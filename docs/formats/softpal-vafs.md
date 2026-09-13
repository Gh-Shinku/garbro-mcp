# Softpal VAFS resource archive

Reference: `GARbro/ArcFormats/Softpal/ArcVAFS.cs`, class `VafsOpener`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/softpal/vafs.ts` (`vafsDescriptor`, `vafsFormat`,
id `softpal-vafs`). Registered extensions are the reference's: `052`, `054`, `055`, `056`, `058`.

## Detection

The file starts with `VAFS` (the registry gates on those four bytes) and the byte at offset 4 must be
`H`. The word at `0x10` is the first payload offset and selects the layout:

* non-zero → the regular offset table layout;
* zero **and** the file name without extension is `TP` → a slot layout, chosen by the extension
  number: `>= 54` uses the newer variant, everything else (including a non-numeric extension) the
  older one.

## Regular layout

`dataOffset = u32@0x10` must be at least `0x10` and below the file size; the entry count is
`(dataOffset − 0x10) / 4`, which must pass `IsSaneCount`. Entries are then produced by walking the
offset table: the first payload starts at `dataOffset`, and every later start comes from the next
word at `0x14 + 4i` until the cursor reaches `dataOffset` (which yields a zero) or the file size.
A `0xFFFFFFFF` word or one that moves backwards ends the listing, and a payload shorter than four
bytes is skipped.

Names are generated as `<base>#<index:05>` where `<base>` is the upper cased file name without
extension. `BGM` archives append `.wav` and are typed `audio`; `PIC` archives are typed `image`;
otherwise the payload decides: a low half word of 1, 3 or 4 means `image`, a payload larger than
`0x200` whose size and signature share the same `>> 9` scale means `audio`, and anything else falls
back to the shared `detectFileType` table. The type is reported in entry metadata.

## Slot layout (`TP`)

The slot table starts at `0x20` with a `0x10` stride and the walk stops at the first non-zero word
(giving up at `0xA010`), whose value is the data offset. Every non-zero slot word before the data
area becomes an entry, named `TP#<slot / 0x10 − 1>.wav`, either with five digits (older variant) or
six (newer). In the older variant the size is `0x402 × u32@slot+4`; in the newer one the slot word
holds a chunk count instead and every size is the distance to the next offset, the last one the rest
of the file. All entries are typed `audio`, `chunkCount` is reported for the newer variant, and the
archive metadata records which layout was used.

## Deviations

* Extraction stores payloads verbatim. The reference additionally rebuilds audio: `OpenAudioEntry`
  prefixes a RIFF/WAVE header to chunked PCM, and `OpenVoiceEntry`/`OpenVoice055Entry` decode the
  voice entries of the `TP` layouts. Those reconstruction paths are out of scope, so `size` follows
  the index rather than the rebuilt stream.
* A slot layout without a single non-zero slot is declined instead of yielding an empty archive.
* The newer slot variant declines a slot whose derived size would be negative (a following offset
  below the current one), where the reference would produce a wrapped size.
