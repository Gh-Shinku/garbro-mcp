# Acme image format

Reference: `GARbro/Legacy/Acme/ImagePMG.cs`, classes `PmgFormat` and `PmgReader`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/acme/pmg-image.ts` (`acmePmgImageDescriptor`, `acmePmgImageFormat`, id
`acme-pmg-image`, `readPmgLayout`, `unpackPmg`).

## The head

The reference registers the place `0xA0`, which stands as the first of the four places of the first word of the
file — the word that names how many blocks of four places a row of the picture stands in — and, behind it, a
word of no places at all, which every file stands under. A picture of this kind is therefore told by the words
of its head: the head names how many blocks a row of the picture stands in, which stands above nought and at
`0x800` or fewer, the height of the picture, and the three sizes of the walk of the first place of a colour.

## The three places of a colour

Every place of a colour stands under a head of its own — the head of the picture standing as the head of the
first of them — and behind that head stand the words that name the places of its walk and then the places the
walk reads for itself. A place of a colour stands as a place of two places, and the places of the three colours
stand one beside the other at the end.

The walk of a place of a colour stands the places of one row of the picture of its own, walking the whole
picture row by row: every step names a place of the row, and every place of the row stands as two places of the
colour, the place a step names standing beside the place that stands before it by how far behind it stands and
how far beside it stands, or standing as a place the walk reads for itself where it names none. The words that
name the places of the walk stand in the places behind the head, every one of them naming sixteen steps, and the
words the walk reads stand behind those.

## Deviations from the reference

- The reference stands the place of the words that name the places of the walk as a place of the whole picture
  rather than a place of the place of a colour, so the place carries from place to place; this port stands the
  same place the same way and pins what it stands in a place of the test.
- The reference reads the places the walk asks for without reading how many places stand behind the head of the
  file; this port turns a picture whose walk stands outside the file away, where the reference would throw
  while reading it.
- A picture of more than two hundred and fifty six million places is turned away, past which the reference
  would run out of memory.
- The places of the picture stand as places of a bitmap and are handed out as a bitmap, which is what the
  reference hands to the caller that writes its pictures.

## Tests

`tests/formats/acme-pmg-image.test.ts` covers the head of a picture and the heads it is turned away for, the
three places of a colour of a picture and the places they stand as, the places a bitmap is written with, a
picture cut short of the places of its walk, the words of the head a picture is read as, and the finding of a
picture of this kind. The picture of the test stands worked out with a walk of the places of the reference's
own, so its places stand under a walk this port did not work out.
