# Splush Wave Graphics format

Reference: `GARbro/Legacy/SplushWave/ImageSWG.cs`, classes `SwgFormat`, `SwgMetaData` and the walk inside the
format. GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/splush-wave/swg-image.ts` (`splushWaveSwgImageDescriptor`,
`splushWaveSwgImageFormat`, id `splush-wave-swg-image`, `readSwgLayout`, `readSwgPalette`, `SwgCursor`,
`decompressSwgRow`, `unpackSwg`).

The file begins with the word `SWG` — the word the reference registers — the place of the pixels stands at
`0x10` and the place of the colour map at `0x14` (both standing eight bytes behind what they name), the width
and the height stand at `0x20` and `0x22`, the number of planes beyond the two of a colour at `0x28`, and a
byte at `0x2F` says whether the pixels are walked along. A picture with a colour map is of eight bits a pixel,
one of two planes beyond the two of a colour is of thirty two, and every other one of twenty four. The colour
map is the two hundred and fifty six entries of four bytes the shared reader of that kind takes.

Where the pixels are not walked along they stand as they are. Where they are, the walk reads a word of two
bytes that says how, and where that word is not `0x0001` it reads the word again four bytes in — reaching it
only if the first bytes, one for every plane, are all nought, which is the shape of a picture that carries a
size of its own in front of its pixels. A word of nought reads every plane as it stands, a byte a pixel in
turn. A word of one reads a word of two bytes for every row of every plane and then the rows themselves:
plane by plane, every plane from its last row to its first, every row of a plane writing the byte of the
pixel the map `{2, 1, 0, 3}` gives — so a picture of three planes writes the third byte of a pixel with its
first plane and the first byte with its third.

A row is a walk of runs, every one behind a control byte: nought is a byte that stands for the pixel it is
written at, one below `0x81` is as many bytes as the byte itself says plus one, and one of `0x81` and above is
a single byte that stands for as many pixels as reach up to `0x101`. What the walk counts along a row is the
size of the walk rather than the pixels it writes, so a row may come out a pixel or more short of what the
head says it is.

The rows are handed out **bottom up** — the write path of the reference would flip them and so does the
bitmap the port writes, which keeps a positive height. The write path of the reference throws
`NotImplementedException`, so this is a read only format.

Deviations from the reference, in the message only: a walk of a kind other than nought or one, a stream cut
short of its runs and a run that reaches past its own plane are refused, where the reference would return
nought or write past its own array. Where the reference reads the pixels of a picture that is not walked along
and is given fewer bytes than it asks for, what it does not get stands as nought; the port keeps that
behaviour rather than refusing the picture.

The tests cover the head and the three kinds of depth, the marks, sizes and places it is turned away for, all
three kinds of run including a walk across the planes of a picture, a picture that stands as it is, an eight
bit picture with its colour map, a picture whose planes stand one after another, a picture whose rows are
walked along plane by plane from the last row of each, the colour map as it stands, a walk of a kind it does
not know, and a file that does not hold a picture.
