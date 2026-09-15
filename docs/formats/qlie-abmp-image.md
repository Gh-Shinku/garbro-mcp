# QLIE engine image

Reference: `GARbro/ArcFormats/Qlie/ImageABMP.cs`, classes `AbmpFormat` and `Abmp6MetaData`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/qlie/abmp-image.ts` (`qlieAbmpImageDescriptor`,
`qlieAbmpImageFormat`, id `qlie-abmp-image`, `readAbmpLayout`).

The file opens with `ABMP6` and a NUL, and holds **one picture** in one of three formats. The word at offset
`0x0C` is where the picture starts, counted from the end of the container header, and at that place sit the
length of the picture and then the picture itself:

| the picture opens with | the picture is |
| --- | --- |
| the eight bytes of a portable network graphic, of which the first four are the word below | `89 50 4E 47` |
| `FF D8 FF E0`, the start of a JPEG with the marker that follows it | a JPEG |
| `BM`, the two bytes a bitmap opens with | a bitmap |

Everything the metadata reports — the width, the height and the depth — is what the picture says about itself
through the reader of its own format, so a picture no reader would open is not one this format claims. The
container's own word is the length of the picture for the first two kinds, but a **bitmap** carries the length
of the whole of itself in its own header, and that is the length the reference reads instead.

A portable network graphic and a JPEG are handed over **as they are**: the reference decodes them through its
own imaging layer, which this port has no decoder for, so their bytes leave it unchanged — the deviation the
other pass-through formats here take as well. A bitmap is decoded and rewritten as a bitmap, the same way the
reference reads it. The entry is named after the file with the extension of the picture's own kind, `jpg` for
a JPEG.

The tests cover finding a container of each of the three kinds, declining one whose name is not `ABMP6`, one
holding a word no reader of this format reads, what the picture behind the header reports about itself, a
portable network graphic and a JPEG handed over unchanged, a bitmap rewritten as a bitmap, the length of a
bitmap taken from the bitmap itself where the container disagrees with it, and a container with no picture
behind it.
