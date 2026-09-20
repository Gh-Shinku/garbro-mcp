# UK2 engine image format

Reference: `GARbro/Legacy/AyPio/ImagePDT.cs`, classes `PdtFormat`, `PdtMetaData` and `Pdt4Reader`. GARbro
commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/aypio/pdt-image.ts` (`aypioPdtImageDescriptor`,
`aypioPdtImageFormat`, id `aypio-pdt-image`, `readPdt4Layout`, `readPdtPalette`, `unpackPdtPlane`,
`flattenPdtPlanes`, `decodePdt`), with the bitmap writer of `packages/formats/src/shared/bmp.ts`.

The reference registers no word of its own, only the two names `pdt` and `anm`.

## The head

The first byte of the file is thirty four. The two bytes at `0x21` name the two walks of a plane, and the four
words behind them name the left, the top, the right and the bottom edge of the picture: the width of the
picture stands in the places of the bits between its left and its right edge — eight places for every byte —
and its height in the pairs of rows between its top and its bottom edge. A picture of no places, of more than
two thousand and forty eight places of width or of more than five hundred and twelve places of height is
turned away.

## The colours

Sixteen colours of four bits each stand from the first byte behind the head, in a word apiece: the lowest four
places of the word are the blue of the colour, the four behind them the red and the four behind those the
green, every part of four places standing for thirty four places of a colour of eight bits.

## The planes

Four planes stand one behind the other from `0x2B`, every plane standing as many rows of the picture as the
picture is high, one byte for every eight places of a row. A plane is walked a byte of a row at a time, the
bytes of a row standing one after another and a row behind the last byte of the row before it, and every step
of the walk gives a *pair* of rows of that byte:

- a byte that is neither of the two the head names is the first row of the pair and the byte behind it is the
  second row;
- a byte that is the first of the two names how many pairs of rows stand there, and the two bytes behind it
  are the first and the second row of every pair;
- a byte that is the second of the two names how many pairs stand there, and the one byte behind it stands for
  both rows of every pair.

The four planes are then gathered: the places of the four planes stand together in every colour of the
picture — the byte of the first plane in the highest place of a colour, the second plane behind it and so on —
and every byte of a plane carries the colours of eight places of a row, two colours of four places standing in
every byte of the picture. What is handed out is a bitmap of four bits with the sixteen colours of the head.

## Deviations from the reference

- A file of fewer than forty three bytes or whose first byte is not thirty four is turned away; the reference
  would throw while reading its head.
- The port holds the reference's own bounds on the walk of a plane, which writes beyond its own array where a
  byte of the walk names more pairs of rows than the plane holds — a message is thrown where the reference
  throws an index out of range.
- A plane whose bytes do not stand in the file is refused with a message, where the reference reads beyond the
  file and throws.
- The reference writes its picture with the `Indexed4` shape of its own platform and leaves the writing of a
  picture out; the port writes a bitmap of four bits with the colours of the head, which is what the format
  holds.

## Tests

`tests/formats/aypio-pdt-image.test.ts` covers the head and the bounds it is turned away for, the colours of
the head, the gathering of the places of four planes, the walk of the planes of a picture of eight places of
width and two of height, the two walks of a plane and the bytes they share, a picture gathered into a bitmap
with its colours, a file whose first byte is not that of the engine, and a plane that runs out of the file.
The vectors are worked out by hand: the plane bytes `0x80`, `0x40`, `0x20` and `0x10` give the colours `0x12`
and `0x48`, and the two walks of a plane give the colours `0x98`, `0x98`, `0x32` and `0x32`, whose second
plane carries the places nought to three of its byte.
