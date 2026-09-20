# UK2 engine compressed bitmap

Reference: `GARbro/Legacy/AyPio/PdtBitmap.cs`, classes `PdtBmpFormat` and `PdtBmpDecoder`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/aypio/pdt-bmp-image.ts` (`aypioPdtBmpImageDescriptor`,
`aypioPdtBmpImageFormat`, id `aypio-pdt-bmp-image`, `readPdtBmpLayout`, `unpackPdtBits`, `decodePdtBmp`), with
the bitmap readers and writers of `packages/formats/src/shared/bmp.ts` and the back reference of
`packages/formats/src/shared/copy.ts`.

The reference registers the word `PDT\0` and no name at all.

## The container

The file begins with that word and a word behind it that stands at `0x118`. A picture of the container stands at
the beginning of the file, and where the word stands again behind the whole of a picture the second picture —

Every picture carries its own head: the size its walk gives, the size the picture stands in, where its places
and the walk of bits stand, and a name of up to two hundred and fifty six bytes. Every place of the head is
measured from the beginning of the picture itself.

## The walk of bits

The walk of a picture stands in words of four bytes, every word from its last byte towards its first and every
byte from its highest place. What stands before a step of the walk is a run of ones and then a nought, and how
many ones stand there says which way the step takes:

| ones | what the step does |
| ---- | ------------------ |
| none | the byte behind the walk stands for itself |
| one | a copy of what already stands in the picture, as far behind the place at hand as the first integer says and as many bytes long as the second |
| two | a run of copies of the byte before the place at hand, the second integer saying how many of them stand there and the third how far apart they stand |
| three | the byte before the place at hand, again |

An integer of the walk stands in as many places as the ones in front of it say, with the value itself behind
them: the places in front of it are its highest place, so the integer `n + 2^ones` stands there.

places of it as the two pictures share. What is handed out is a bitmap of four byte places, the shape of a
place standing from the picture of the shapes.

## Deviations from the reference

- The reference asks its platform to turn the picture of the shapes into a grey one; the port takes one of the
  three parts of a colour of it, which is the same value where the engine writes the three of them together, as
  it does.
- A file of fewer than eight bytes, a file whose word is not `PDT\0`, a file whose word behind it does not
  stand at `0x118`, a picture whose head does not stand in the file, whose walk or places stand outside it, or
  whose walk gives no bitmap at all are turned away; the reference would throw while reading its head.
  byte the walk reads that does not stand in the file are refused with a message, where the reference reaches
  beyond its own arrays or throws.
  picture that is not a bitmap of a kind it reads is refused; a picture of fewer than thirty two bits a place
  stands with a whole shape, which is what the framework's own conversions carry.

## Tests

`tests/formats/aypio-pdt-bmp-image.test.ts` covers the four ways of the walk of bits — a byte of its own, a
copy behind the place at hand, a run of copies and the byte before the place at hand — the head of a picture,
shape of a place, a picture handed out as a bitmap of four byte places, a file that does not hold a bitmap, and
a walk that runs out of its words and of its places. The vectors are worked out by hand: the walk `0010100100`
gives `ABAB` and the walk `001100100` gives `ABBB`.
