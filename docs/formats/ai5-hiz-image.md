# elf bitmap format (HIZ)

Reference: `GARbro/ArcFormats/elf/ImageHIZ.cs`, classes `HizFormat` and `HizMetaData` (GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/elf/hiz-image.ts` (`ai5HizImageDescriptor`, `ai5HizImageFormat`, id
`ai5-hiz-image`). The composite picture of the same file is ported alongside it as `ai5-hip-image`, and the two
share their header reader and their pixel reader.

A picture of thirty two bits behind an exclusive-ored header:

| offset | field |
|---|---|
| 0 | `hiz` |
| 4 | a count, which has to be a hundred |
| 8 | width, exclusive-ored with `0xAA5A5A5A` |
| 12 | height, exclusive-ored with `0xAC9326AF` |
| 16 | a word that says the file is something else |
| 20 | the size of the picture, exclusive-ored with `0x19739D6A` |
| 24 | fifty two bytes the reference never looks at |
| 76 | the pixels, LZSS |

Every measurement is hidden the same way, and the size behind the fourth word has to be **exactly** the pixels of
the measurements: the reference multiplies width, height and four in the arithmetic of an unsigned word and
compares the result, so a header whose product wraps around is one whose pixels cannot be held — and this reader
refuses it rather than trying to. The word at sixteen says the file is another format of this engine rather than a
picture of this kind, and the reference refuses a file that carries it.

## The pixels

The stream behind the header carries **four planes**, one byte of every pixel each, read one plane after another
and woven into whole pixels blue, green, red and alpha. The reference reads the planes one by one from a single
LZSS stream and refuses any plane that falls short of the whole picture; reading the stream in one go and weaving
it after gives the same bytes and refuses the same files, and the port does that.

A stream that carries less than the whole picture stops with the error the reference gives for it, `Unexpected end
of file`; input behind the last pixel is never read.

The picture is built with `ImageData.Create`, which keeps its rows top down; the port writes a bitmap with a
**negative height** at the same place.

The tests cover the word and the count behind it, the word that says the file is another format, a size that does
not match the measurements, a picture of no width, a file too short for a header and a word that is not the
format's, the four planes woven into whole pixels with the bytes between the fields and the picture never looked
at, a stream that carries less than the whole picture, and bytes behind the last pixel that are never read.
