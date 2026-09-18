# BasiL image format

Reference: `GARbro/ArcFormats/Basil/ImageBCF.cs`, classes `BcfFormat`, `BcfMetaData` and `BcfReader`. GARbro
commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/basil/bcf-image.ts` (`basilBcfImageDescriptor`,
`basilBcfImageFormat`, id `basil-bcf-image`, `readBcfLayout`, `lzUnpackBcf`, `unpackBcf`).

The file begins with the word `BCF` and a nought behind it. The width and the height stand at four and six
as words, the row of the colour plane at eight as a word, the steps of the two bit streams at twelve and
thirteen as bytes, and four places — of the colour data, of its bits, of the alpha plane and of its bits —
stand from sixteen as words. A picture has an alpha plane exactly when its own place is not nought, so the
depth is twenty four bits without one and thirty two with it.

`BcfReader.LzUnpack` walks a bit a step. A clear bit is a byte that stands itself; a set one is a reference
of two bytes, whose lowest **step** bits count the bytes it takes and whose rest counts the places behind the
walk it takes them from, both starting from one. The walk copies a byte at a time, so a reference may take
from its own output. The step five and below are the five the reference's own table holds.

The colour plane is unfolded first, of the size the row the head declares holds for every row — so the rows
of that plane may be wider than the picture. An alpha plane is then unfolded the same way, of exactly a byte
a pixel, and the two are woven together a pixel at a time: the colour's three bytes and then the alpha of
that pixel, into rows of four bytes a pixel. The rows are handed out **bottom up**, which is what
`ImageData.CreateFlipped` means, and the padding of the colour plane's own rows is taken out before the
bitmap is written.

Deviations from the reference, all in the message only: a step past the table's end, a reference that reaches
before the start or past the end of what it writes, and a stream that ends inside either walk are refused,
where the reference would read or write past its own arrays. The write path of the reference throws
`NotImplementedException`, so this is a read only format.

The tests cover the head of both depths, the fields the reader is turned away for, bytes that stand and
references that reach back, references that reach outside the plane, the twenty four bit picture written out
with its padding taken out, and the alpha plane woven into a thirty two bit one.
