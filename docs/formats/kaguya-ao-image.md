# KaGuYa AO image

Reference: `GARbro/ArcFormats/Kaguya/ImageAO.cs`, class `AoFormat : ApFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/kaguya/ao-image.ts` (`aoImageDescriptor`, `aoImageFormat`, id
`kaguya-ao-image`).

| field | offset |
|---|---|
| marker `AO` | 0 |
| width (`u32`) | 2 |
| height (`u32`) | 6 |
| depth (`i16`) | 0xA |
| origin x (`i32`) | 0xC |
| origin y (`i32`) | 0x10 |
| pixels, bottom row first | 0x14 |

## A subclass that only extends the header

This format is the base class's header plus two signed origin fields, and its reader is the base class's
`ReadBitmapData` reached from offset 0x14 rather than 0xC. The port therefore reuses the helpers exported by
`ap-image.ts` — this is the **second** consumer of that reader, which is what makes the extraction of shared
code worthwhile rather than speculative.

The marker is the only thing that separates the two formats, and both directions matter: an `AP` file must not
be taken for this one, and this one is four bytes longer than the base format's header, so it is not a valid
base-format file either. A test asserts both probes reject the other's files.

The two origins are **signed** and may be negative, so a story can place a sprite partly off screen. The port
carries them into the entry and archive metadata rather than into the pixels, since a bitmap has nowhere to put
them.

## A classification note

`AoFormat` is one of three formats built on `ApFormat`; `Aps3Format` and the unrelated `Ap0Format` in the same
file are still to come. The depth and dimension rules are the base class's, so the twenty four bit case is again
a label on four byte pixels, and a zero dimension is again accepted.

## Notes

* `Write` is implemented in the reference and always writes a depth of twenty four; this port is a reader, so
  `create` is false.
* Because the extraction gains a header, `sizeKnown` is false.
* The declared extension list is the format's own `sp_`, which like the base format's list is not a gate.
