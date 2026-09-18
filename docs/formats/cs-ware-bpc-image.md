# C's ware bitmap format

Reference: `GARbro/ArcFormats/CsWare/ImageBPC.cs`, classes `BpcFormat` and `BpcReader`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/csware/bpc-image.ts` (`csWareBpcImageDescriptor`,
`csWareBpcImageFormat`, id `cs-ware-bpc-image`, `readBpcLayout`, `readBpcPalette`, `unpackBpc`).

The file begins with the word `0x28`, which is also where its pixels stand — the reference keeps that one word
as both the word it is found by and the place it reads its pixels from — the width and the height stand at
four and eight as words, and the depth of a pixel at `0x0E` as a word of two bytes. Only the depths of one,
eight and twenty four bits are read. A row of the picture stands the reference's own arithmetic wide: a byte
for a picture of eight bits, eight pixels for one of one bit and three bytes for one of twenty four — which
only lines up with the size a bitmap lays its rows out with where a row of one bit pixels is a whole number of
bytes.

The colour map of a picture of one or eight bits stands where the pixels do, two or two hundred and fifty six
entries of four bytes. A picture of one bit a pixel then stands as it stands. A picture of eight bits reads a
word of its walk's size, then the control byte of the walk and, where that control is the escape `0xF5`, the
byte its runs stand behind, and then the walk itself: a byte that is not the control stands as it is, the
control stands in front of a count whose runs are the byte **before** the control, and where the control is
the escape and the byte after it is the one the runs stand behind the count stands one byte further on — while
an escape whose byte does not match stands as a byte of the picture itself.

A picture of twenty four bits stands in three planes, one for every byte of a pixel, every one of them a walk
behind the same kind of control and with a size of its own. What a plane counts along its walk is the bytes it
reads — one for a byte that stands, two for the control and its count, and three for the escape, the byte its
runs stand behind and the count — and every plane writes one byte of every pixel it reaches, the first plane
the first byte of a pixel, the second the one behind it and the third the one behind that.

The rows are handed out **bottom up** — the write path of the reference would flip them and so does the bitmap
the port writes, which keeps a positive height. The write path of the reference throws
`NotImplementedException`, so this is a read only format.

Deviations from the reference, in the message only: a walk that begins with a run — where the reference would
read one byte before its own array — a walk cut short and a run that reaches past the picture are refused,
where the reference would throw an `IndexOutOfRangeException` or an `InvalidFormatException` of its own.

The tests cover the head, the word and the depth it is turned away for, a picture of one bit a pixel with its
two entry colour map, a picture of eight bits with a control of its own, one with the escape and the byte its
runs stand behind, one whose escape stands as a byte of the picture itself, a picture of twenty four bits in
three planes both with a control and with the escape, a walk that begins with a run, and a file that does not
hold a bitmap.
