# Ponytail Soft NMI image format

Reference: `GARbro/Legacy/Ponytail/ImageTSZ.cs`, classes `TszFormat` and `TszReader`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/ponytail/tsz-image.ts` (`ponytailTszImageDescriptor`,
`ponytailTszImageFormat`, id `ponytail-tsz-image`, `readTszLayout`, `readTszPalette`, `decodeTsz`,
`gatherTszScanline`), with the bitmap writer of `packages/formats/src/shared/bmp.ts`.

The reference registers the word `NMI ` and no name at all. `TCZ` shares a word with this format and is left
out here; it stands over the same reader and is kept for a port of its own.

## The head

The word `NMI ` stands at the beginning of the file, the word `2.05` at `0x04`, the width of the picture in
fours of places in the word at `0x0C` and its height in the word at `0x0E`. Behind the head stand sixteen
colours, three bytes apiece — the red of the colour first, then its green and its blue — and every byte of a
colour stands for the colour of four places, being used in both halves of a byte.

the two halves of a line buffer as long as two columns. A step of the walk gives a run of places of a column,
how long the run stands being the run of places in front of the step:

| the places in front of the step | how long the run stands |
| ------------------------------- | ----------------------- |
| two and a place of a run | one place, taken from the file as it stands |
| four and a place of a run | one place, taken from the place a whole line behind and kept in part by the byte of the step |

Where the run of places in front of the step stands at one, three or none, the run is a copy of places that
stand behind it, and how long it stands is named by the places behind that run: one place of the file names a
run of one, and otherwise the highest place of the run stands for as many places as the run of ones in front of
it says, with the places behind it naming the rest. The three steps differ in where the places copied stand:

| the places in front of the step | where the run is taken from |
| ------------------------------- | --------------------------- |
| none | the column before the one at hand, a whole line behind it, at four places the step names |
| one | the same, at a byte the step names |
| three | the column at hand, at four places the step names |

A run whose places stand over the places it is written to repeats them, which is what the reference does. Once
both columns of a pair stand in the line buffer, they are gathered into the four bytes of a row, eight places
of a pair of columns standing in every four bytes: the two halves of the buffer hold the two columns, and the
four places of a word stand for the four places of two colours. What is handed out is a bitmap of four bits.

## Deviations from the reference

- A file of fewer than sixteen bytes, a file that does not hold the word of the format, a file whose head does
  not name both a width and a height, and a picture of more places than this project will hold are turned away;
  the reference would throw or run out of memory while reading.
- A walk that runs out of the file, a walk that names more places than a word holds in a run of ones, a walk
  that takes a way its table does not know, and a copy whose places stand outside the line buffer are refused
  with a message, where the reference reads beyond the file and throws while gathering its places.

## Tests

`tests/formats/ponytail-tsz-image.test.ts` covers the head and the words it is turned away for, a picture of
no places, the colours of a picture, the picture a file hands out as a bitmap of four bits, and a picture whose
walk takes every one of its five ways. Both the picture of four words and the picture of all five ways are
worked out with an independent transcription of the reference's own walk; the second of them is built by
modelling the reference's reader, which interleaves its bit walk with the places it reads whole.
