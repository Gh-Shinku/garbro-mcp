# AdvSys3 engine image format

Reference: `GARbro/ArcFormats/AdvSys/ImageGWD.cs`, classes `GwdFormat` and `GwdReader`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/advsys/gwd-image.ts` (`advSysGwdImageDescriptor`, `advSysGwdImageFormat`,
id `advsys-gwd-image`, `readGwdLayout`, `readGwdShapeLayout`, `readGwdCount`, `fillGwdLine`, `decodeGwd`,
`composeGwd`), with the most significant place first bit walk of `@garbro-mcp/codecs` and the bitmap writers of
`packages/formats/src/shared/bmp.ts`.

The reference registers no word at all and no name of its own; a picture is told by the word `GWD` at `0x04`.

## The head

The word at the front of the file names how many bytes the parts of the picture stand in, counting from four
places into the file; the word `GWD` stands at `0x04`, the width of the picture in the two places at `0x07`
and its height in the two at `0x09` stand the other way round from the rest of the file, and the place at
`0x0B` names the places of a colour. The walk of the places begins at `0x0C`.

## The walk of the places

A step of the walk names a run of places of a line and, where the places of a colour that stand behind it name
any, as many places of a colour as those places name and one. A run of no places of a colour stands for as many
places of the line that stand at nought. Every place of a line then stands behind the place before it, every
place of the table the reference builds naming the place that stands over a place where the two before it are
known.

A picture of eight places of a colour walks one line at a time, and a picture of twenty four walks three lines
at a time, one line each for the blue places of a colour, the green and the red, so that the places of a colour
stand one after the other in a row. The places of a picture stand as many places in a row as the picture is
wide, without the places a bitmap stands beyond the last place of a row.

## The shape of the places

Where the places of a picture of twenty four bits stand, the place behind them names whether a shape of those
places stands behind it; where it stands, the shape stands as a picture of eight bits of its own, as wide and
as high as the picture whose places it stands beside, and the places of the shape stand the other way round
from the places of the picture, one place of the shape for every place of a colour.

## Deviations from the reference

- A file of fewer than twelve bytes, a file that does not hold the word of the format, a file whose head names
  no width or height, a picture whose places of a colour stand beside any but eight and twenty four, and a
  picture of more places than this project will hold are turned away; the reference would throw while reading
  its head, or while walking the places of a picture of another kind.
- A walk that runs out of the file, a run of places that would stand beyond a line, and a run of places in
  front of a step that stands wider than a word are refused with a message. The reference reads no places at
  the end of its own stream and stands still while walking a line, and reads places that do not stand in the
  file at the places of a colour, so the two differ there.
- The shape of the places is stood beside the places of the picture only where it heads itself with the word of
  this format, stands as a picture of eight bits and stands as wide and as high as the picture; the reference
  checks the same three things.

## Tests

`tests/formats/advsys-gwd-image.test.ts` covers the head and the words it is turned away for, a picture of no
places and one whose places of a colour stand beside another number, the walk of a picture of eight bits and of
twenty four, the shape of the places and the shape that does not stand as wide as the picture, the bitmap a
file hands out of either kind, and the finding of a picture of its own kind. Both pictures are worked out with
an independent transcription of the reference's own walk, and the head of a picture with a shape behind it
names where that shape stands the way the reference reads it.
