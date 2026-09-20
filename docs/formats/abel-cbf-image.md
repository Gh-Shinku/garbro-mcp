# Abel image format

Reference: `GARbro/ArcFormats/Abel/ImageCBF.cs`, classes `CbfFormat`, `CbfMetaData` and `CbfReader`. GARbro
commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/abel/cbf-image.ts` (`abelCbfImageDescriptor`, `abelCbfImageFormat`, id
`abel-cbf-image`, `readCbfLayout`, `decodeCbf`, `readCbfAlpha`, `mergeCbfAlpha`), with the bitmap writers of
`packages/formats/src/shared/bmp.ts`, the back reference of `packages/formats/src/shared/copy.ts`, the walk of
the LZSS kind of `@garbro-mcp/codecs` and the companion file reader of
`packages/formats/src/shared/companion.ts`.

The reference registers the four words `CBF0`, `CBF1`, `CBF2` and `CBF3` and no name at all.

## The head

The first four bytes of the file are one of those four words, the byte at three saying which way the places of
the picture stand; the word at `0x10` stands at one and the words behind the word of the format are the width,
the height and the places of a colour. A picture of no places is turned away.

## The four ways the places stand

| the word | what stands behind the head |
| -------- | --------------------------- |
| `CBF0` | the places of the picture, three byte places apiece, as they are |
| `CBF1` | a walk of the LZSS kind, every place of which stands over the place three behind it, and the places of every block of eight places by eight taken out of it in the order of a zigzag |
| `CBF2` | a walk of runs: three byte places at a time and a byte behind them, nought standing for the one place at hand and anything else for that many places of the colour |
| `CBF3` | a walk of runs behind a walk of the LZSS kind, which stands four bytes behind the head |

The walk of the first way stands the places of a block in the order of the zigzag of `ZigzagOrder`: the places
of the walk stand one behind the other, block behind block, and every place of a block stands where the table
says. What is handed out is a bitmap of twenty four bits.

## The shape of the places

Where a file whose name is the name of the picture with the name `alp` stands beside it, its places stand for
the shape of the places of the picture: the word `ALP1`, how many places the shape holds, and then a byte with
a count behind it at a time, the byte standing for as many places as the count names. What is handed out is
then a bitmap of thirty two bits, the shape of a place standing in the fourth place of a colour. A shape that
does not stand beside the picture or does not hold the word of its own is left out, which is what the
reference does with a shape whose reading fails.

## Deviations from the reference

- A file of fewer than twenty four bytes, a file whose first four bytes are not one of the four words of the
  format, a file whose word at `0x10` does not stand at one, a file whose byte at three names no way the
  places stand, and a picture of no places or of more places than this project will hold are turned away; the
  reference would throw while reading its head.
- A picture whose places do not stand in the file, a walk that reaches beyond the places of the picture, and a
  walk of the LZSS kind that gives less than the picture holds are refused with a message, where the reference
  reads beyond the file and throws.
- The places a walk of runs gives beyond the picture are left out rather than refused, which is what matters
  only where the walk of a file names more places than the picture holds.

## Tests

`tests/formats/abel-cbf-image.test.ts` covers the head, the four words and the flag it is turned away for, the
places that stand as they are, the places that stand in runs, the places that stand in the zigzag of the blocks
behind a walk of the LZSS kind, the places that stand in runs behind such a walk, the shape of the places of a
companion file and the merging of it into four byte places, a picture gathered into a bitmap, a picture whose
shape stands beside it, and a file that does not hold a picture. The vector of the zigzag is worked out with an
independent transcription of the reference's own walk, which is also what fixes the direction of the walk that
stands over the place three behind every place of a picture.
