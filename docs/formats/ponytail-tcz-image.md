# Ponytail Soft NMI 2.5 image format

Reference: `GARbro/Legacy/Ponytail/ImageTCZ.cs`, classes `TczFormat` and `TczReader`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/ponytail/tcz-image.ts` (`ponytailTczImageDescriptor`,
`ponytailTczImageFormat`, id `ponytail-tcz-image`, `readTczLayout`, `decodeTcz`, `gatherTczScanline`), which
stands over the reader of `packages/formats/src/ponytail/tsz-image.ts` — the run of places in front of a step
and the words a walk reads whole are the ones of the first kind, as they are in the reference, where
`TczReader` stands over `TszReader`. The back reference of a copy comes from
`packages/formats/src/shared/copy.ts` and the bitmap from `packages/formats/src/shared/bmp.ts`.

The reference registers the word `NMI `, the word of the first kind of its pictures, and no name at all; the
two are told apart by the word behind the word of the format, which stands at `2.05` for the first kind and at
`2.5` for this one.

## The head

The width of the picture stands in the word at `0x0C`, its height in the word at `0x0E`; unlike the first kind
of its pictures the width counts places rather than fours of places, and a picture stands at most `0x190`
places high. How far the picture stands from the corner of its own place stands in the words at `0x08` and
stand sixteen colours, three bytes apiece, the same way as for the first kind.

place two behind:

| the places in front of the step | what the step does |
| ------------------------------- | ------------------ |
| `0`, then a word of four places for each end of the place taken | one place gathered out of the place two behind, eight places at a time |
| `1 0` and four places | a run of places standing as many lines behind the column at hand as the four places name, and as many places beside it as a whole column holds less a place and the line |
| `1 1 0` and two places | a run standing four, three or two places behind the column at hand each way |
| `1 1 1 0` and three places | a run standing two whole columns behind the column at hand, plus as many places as the three name |
| `1 1 1 1 0` and three places | the same, four columns behind |
| `1 1 1 1 1` and three places | the same, eight columns behind |

How long a run stands is one place more than the run of places behind the first place of the step names, the
same way as for the first kind. Every four columns the picture holds are gathered into the four bytes of a row
as soon as they all stand in the buffer, and the walk then stands over the column sixteen columns further on.
What is handed out is a bitmap of four bits.

## Deviations from the reference

- A file of fewer than sixteen bytes, a file that does not hold the word of the format or the word behind it, a
  file whose head names no width or height, a picture that stands higher than the greatest height, and a
  picture of more places than this project will hold are turned away; the reference would throw or run out of
  memory while reading.
- A walk that runs out of the file, a run of places that stands outside the buffer, and a run of ones in front
  of a step that stands wider than a word are refused with a message, where the reference reads beyond the file
  and throws while gathering its places.
- The reference keeps the width of the picture as it stands and gathers `width >> 1` columns; a picture whose
  width is not even therefore loses the places that stand beyond its last whole column, which this project does
  the same way.

## Tests

`tests/formats/ponytail-tcz-image.test.ts` covers the head and the words it is turned away for, a picture of
no places or of too great a height, the picture a file hands out as a bitmap of four bits, and the telling
apart of the two kinds of Ponytail Soft pictures, whose word stands the same. The picture of the walk is a
picture whose walk takes every way it knows, standing over an independent transcription of the reference's own
walk.
