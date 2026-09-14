# Ai5 engine image mask (MSK/AI5)

Reference: `GARbro/ArcFormats/elf/ImageGP8.cs`, class `MskFormat` (GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/elf/gp8-image.ts` (`ai5MskImageDescriptor`, `ai5MskImageFormat`, id
`ai5-msk-image`). It shares its reader with the indexed picture of the same file, `ai5-gp8-image`, and differs
from it in three ways: it carries the extension `msk`, it has no palette, and it allows its picture further from
the beginning.

| offset | field |
|---|---|
| 0 | x, signed |
| 2 | y, signed |
| 4 | width, signed |
| 6 | height, signed |
| 8 | the pixels, LZSS |

The positions may lie within two thousand and forty eight of the beginning — twice what the indexed kind allows —
and the measurements within four thousand and ninety six. The reference reads its eight bytes **without asking
whether they are there**, so a file of fewer than eight bytes stops the reader rather than being refused by it;
GARbro's own dispatch catches that and moves on, so such a file is declined here as well.

The picture is a mask of grey levels, so the port writes a bitmap of eight bits with the palette of two hundred
and fifty six levels of grey that `PixelFormats.Gray8` stands for.

## Telling the two kinds apart

Nothing **in** a file says which of the two it is: a picture placed within three hundred of the beginning and
measured within four thousand and ninety six satisfies both readers, and the reference registers both with no word
of their own, so it tries them in the order its catalog gives. What tells them apart in practice is the name: the
mask claims the extension `msk`, and the port keeps that claim, so a mask is offered to the mask reader first
while an indexed picture of some other name is offered to the indexed reader, which wants the palette the mask
does not have.

The tests cover the word and the extension, a picture at the edge of what the mask allows and just past it, a
file short of a header, a file both readers would take, the grey palette with the position of the picture carried
into its measurements, and a stream that carries less than the whole picture.
