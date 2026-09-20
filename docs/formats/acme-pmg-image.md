# Acme image format

Reference: `GARbro/Legacy/Acme/ImagePMG.cs`, classes `PmgFormat` and `PmgReader`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/acme/pmg-image.ts` (`acmePmgImageDescriptor`, `acmePmgImageFormat`, id
`acme-pmg-image`, `readPmgLayout`, `unpackPmg`).

## The head

file — the word that names how many blocks of four places a row of the picture stands in — and, behind it, a
of its head: the head names how many blocks a row of the picture stands in, which stands above nought and at

## The three places of a colour

Every place of a colour stands under a head of its own — the head of the picture standing as the head of the
stand one beside the other at the end.

colour, the place a step names standing beside the place that stands before it by how far behind it stands and
how far beside it stands, or standing as a place the walk reads for itself where it names none. The words that
words the walk reads stand behind those.

## Deviations from the reference

  rather than a place of the place of a colour, so the place carries from place to place; this port stands the
  same place the same way and pins what it stands in a place of the test.
- The reference reads the places the walk asks for without reading how many places stand behind the head of the
  file; this port turns a picture whose walk stands outside the file away, where the reference would throw
  while reading it.
- A picture of more than two hundred and fifty six million places is turned away, past which the reference
  would run out of memory.
  reference hands to the caller that writes its pictures.

## Tests

`tests/formats/acme-pmg-image.test.ts` covers the head of a picture and the heads it is turned away for, the
three places of a colour of a picture and the places they stand as, the places a bitmap is written with, a
own, so its places stand under a walk this port did not work out.
