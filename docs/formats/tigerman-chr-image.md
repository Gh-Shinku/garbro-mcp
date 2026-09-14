# Tigerman Project compound image (CHR/TIGERMAN)

Reference: `GARbro/Legacy/Tigerman/ImageCHR.cs`, classes `ChrFormat` and `ChrMetaData` — the **image** format of
that name, not the archive `ChrOpener` of `ArcCHR.cs`, which is ported separately as `tigerman-chr`. The two share
the tag `CHR/TIGERMAN` and are told apart by their kind and their class. (GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT.)

Implementation: `packages/formats/src/tigerman/chr-image.ts` (`tigermanChrImageDescriptor`,
`tigermanChrImageFormat`, id `tigerman-chr-image`).

A compound file: two offsets and then a picture of **another** format — a Silky's image (`ZIT`) — carried inside
it. The reference keeps no reader of its own: it reads the metadata and the pixels of the picture through the
Silky's format and hands the result on, and the port does the same, through the exported
`readZitImageLayout` and `renderZitImage` of `silky/zit-image.ts`.

## The header

| offset | field |
|---|---|
| 0 | where the picture begins |
| 4 | how long the picture is |

The offset has to lie **inside** the file and the offset plus the length has to reach **no further** than its end;
the reference makes both checks in the arithmetic of an unsigned thirty-two bit word, where a sum may wrap around,
and the port makes them in full-width arithmetic instead. Nothing else of the file is read: the picture is taken
from its own bytes whether or not anything in front of them looks like a header.

The picture behind the offsets must be one of the three kinds of Silky's image, which is the real gate the
reference has — its own declared word never decides anything by itself.

## What makes a file this format's

The reference declares no word of its own, but it registers `0x01B1` besides nothing, and the three extensions
`chr`, `cls` and `ev`. A file of one of those extensions is offered to it, and so is a file that begins with that
word whatever its extension — because `0x01B1` is where the files of this engine keep their picture, which makes
the first four bytes of the file and the offset it carries the same number. The port offers itself in both cases
and then asks the picture behind the offsets, as the reference does.

## The picture

The port reads the region the two offsets name into a buffer and hands it to the Silky's reader, rather than
keeping the reference's view of the whole file open; the region is bounded either way, so a picture that runs past
its end stops with the same error the reader gives for a cut short file.

The entry the port reports is the region itself, so its size is the length the header gives and its content is
unchanged, while the picture that comes out of it is a bitmap of the kind the Silky's reader builds.

The tests cover the three extensions and the registered word with the picture at the offset it names, a file of
another extension whose picture is elsewhere, a file with no picture at all, an offset at the end of the file and
a length that would wrap around, a three byte picture with its green key, the four byte and palette kinds, and a
region cut short behind the header of the picture.
