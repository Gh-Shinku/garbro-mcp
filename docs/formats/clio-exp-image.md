# Clio compressed bitmap

Reference: `GARbro/Legacy/Clio/ImageEXP.cs`, classes `ExpFormat`, `ExpMetaData` and `ExpReader`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/clio/exp-image.ts` (`clioExpImageDescriptor`, `clioExpImageFormat`, id
`clio-exp-image`, `readExpLayout`, `unpackExp`).

The file begins with the word `PXEN`, then a name of thirty two bytes and the size of the bitmap as a word.
The reference unfolds the first fifty four bytes of that bitmap and reads them through its own bitmap reader,
so the measurements and the depth are that reader's; the port does the same and then reads the whole bitmap
with the shared reader and writes it out again at the depth it was stored in.

The stream is a walk of blocks. Every block begins by resetting a table of two hundred and fifty six entries
to name themselves, and then reads that table:

* a control byte above one hundred and twenty seven moves the place on by the control less one hundred and
  twenty seven and reads nothing itself;
* the control as it then stands is one less than the run of entries that follow.

Every entry is one byte, and a byte that does not name its own place takes a **second** byte behind it.
Behind the table stands a count of two bytes and then that many tokens:

* a token that names its own place is a byte of the picture;
* every other token puts its second byte and then its own place on a stack, which is walked from the top, so a
  token may expand into more tokens.

The reference builds that stack on the name it read from the head, so it holds at most thirty two bytes. This
port refuses a stack that would grow past it, which the reference's own array write answers with an exception
(a documented deviation in the message only), and a stream that stops where a byte is wanted, which the
reference's own byte read would take as nothing. The write path of the reference throws
`NotImplementedException`, so this is a read only format.

The tests cover the head and the measurements of the bitmap behind it, the signature and the size of the
bitmap and a stream that does not unfold to a bitmap head, the measurements and the unfolding the port
reports, the bitmap unfolded again, a dictionary token that expands onto the stack, a stream that stops where
a byte is wanted, and a file that does not hold a picture.
