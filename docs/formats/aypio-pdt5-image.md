# UK2 engine image format of the second kind

Reference: `GARbro/Legacy/AyPio/ImagePDT5.cs`, classes `Pdt5Format` and `Pdt5Reader`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/aypio/pdt5-image.ts` (`aypioPdt5ImageDescriptor`,
`aypioPdt5ImageFormat`, id `aypio-pdt5-image`, `readPdt5Layout`, `readPdt5Palette`, `decodePdt5`), with the
bitmap writer of `packages/formats/src/shared/bmp.ts`, the back reference of
`packages/formats/src/shared/copy.ts` and the colours of `packages/formats/src/aypio/pdt-image.ts`.

The reference registers no word of its own, only the two names `pdt` and `anm`; the picture of the other kind
of this engine answers to the very names and is told apart by the first byte of the file.

## The head and the colours

The first byte of the file is thirty five and the four words behind it name the left, the top, the right and
its right edge — eight places for every byte — and its height in the places between its top and its bottom
edge; a picture of more than six hundred and forty places of width or of more than a thousand and twenty four
places of height is turned away. Sixteen colours stand from the first byte behind the head, the way the colours

## The walk of the picture

hand standing at the third of them, two places in. The walk takes the **lowest** place of a byte first — the
other way round from the way the other picture of this engine reads its own — and every step stands for places
of the row at hand:

| the places in front of the step | what the step does |
| ------------------------------- | ------------------ |
| `1 1 1` | a run of the place at hand, one place more than the count names, two places at the least |
| `1 0` | the place that stands from the places around the place at hand |

The count of a step is a run of ones, every one of them standing for a part of it — the first for one place,
the second for two, the third for four and so on — and the parts behind the run are read from the highest of
them down, every one of them that stands adding what the part holds. The place that stands from the places
around it is taken from the place in the row behind it, the place two rows behind it and the two places beside
that one, one of them standing for itself wherever the two behind it stand together — the reference's own
`GetPixel`.

The row at hand is then taken into the picture and the window slides along by a row. What is handed out is a
bitmap of **eight** bits with the sixteen colours of the head, although the head of the reference names four
the reference's own reader hands its platform.

## Deviations from the reference

- A file of fewer than forty one bytes, a file whose first byte is not thirty five, a picture whose width or
  height does not stand above nought or stands beyond what this project will hold is turned away; the reference
  would throw while reading its head, and the names of the format are what its own catalog holds it by.
- A walk that runs out of the file, a walk that reaches beyond the window, and a place that stands beyond the
  file and throws.
- The count of a step that stands too far beyond what a picture of this engine holds is refused with a message
  as well, where the reference would keep doubling it.

## Tests

`tests/formats/aypio-pdt5-image.test.ts` covers the head and the bounds it is turned away for, the colours of
on the place at hand, the walk of a picture whose places lean on the places beside them and on the places
around them, a picture gathered into a bitmap of eight bits, a file whose name is not one of the two names of
the format, and a walk that runs out of the file. The vectors are worked out with an independent transcription
of the reference's own walk: the first vector gives the places 1, 2, 2, 2, 2, 2, 2 and 2, and the second one
gives 1, 1, 1, 1 and then nought, the places around the place at hand standing as nought on the first row.
