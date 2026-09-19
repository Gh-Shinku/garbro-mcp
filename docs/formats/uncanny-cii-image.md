# Uncanny image format

Reference: `GARbro/Legacy/Uncanny/ImageCII.cs`, classes `CiiFormat`, `CiiMetaData` and `CiiReader`. GARbro
commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/uncanny/cii-image.ts` (`uncannyCiiImageDescriptor`,
`uncannyCiiImageFormat`, id `uncanny-cii-image`, `readCiiLayout`, `readCiiPalette`, `unpackCiiRle`, `unpackCii`).

The file begins with a word of two bytes at nought whose kind says how deep a pixel is: five means twenty four
bits, and the kinds three and two, with the highest place of the word left out, mean eight and four. The width
and the height stand at two and four as words of two bytes and both have to stand above nought, and the count
of colours stands at six; a picture of eight bits or less may hold no more colours than a pixel of it can
name. The highest place of the byte at one says the picture is walked along. A row of the picture stands the
reference's own arithmetic wide — a byte for a picture of eight bits and half of one for a picture of four —
and the picture carries a row of nothing behind an odd number of rows.

The colour map of a picture of eight bits or less stands where the head ends, the count of colours of the head
long, four bytes an entry. The picture then either stands as it stands or is walked along: a byte whose
highest place stands is a count of up to a hundred and twenty eight — the seven places below it, plus one —
that stands in front of the byte the picture takes over and over, and any other byte is a count of up to a
hundred and twenty eight bytes that stand as they are. The walk ends where the picture is whole or where the
file does.

A picture of twenty four bits stands in blocks of two by two pixels. Every block carries two signed bytes that
turn into the three colours of a pixel of its own — one that steps the blue one way and the red the other, one
that steps the green against both — and then four bytes that stand on top of them, one for every pixel of the
block: the first two for the pixels of a row and the second two for the row behind them. Every byte of the
block is the colour it carries added to the one the block gave it and held between nought and the whole of a
byte. A block of four pixels therefore takes six bytes of the file, which is the point of the kind.

What is handed out is a bitmap of four or eight bits with the colour map of the picture, where the colour map
goes through the four bit writer as red, green and blue triples rather than the blue, green, red and left
alone entries the reader of the reference hands it, or a bitmap of twenty four bits. It stands **top down**,
which is what `ImageData.Create` means, and its rows are gathered into the size a bitmap lays its own rows out
with — which for a picture of four bits or one only lines up with the reference's own rows where a row of the
picture is already a whole number of words.

Deviations from the reference, in the message only: a picture cut short of its walk, its blocks or its pixels
is refused, where the reference would read outside its own array. The walk of the reference reads a run of
bytes past the end of the file where the file is cut short; the port writes the bytes that stand and stops.

The tests cover the head and all three depths, the kinds, sizes and counts of colours it is turned away for,
the walked bit, both kinds of run of the walk, a picture of eight bits standing as it stands and one that is
walked along, a picture of four bits, a picture of twenty four bits in blocks of four pixels, the colours of a
block held between nought and the whole, the colour map as the head gives it, and a file that does not hold a
picture.
