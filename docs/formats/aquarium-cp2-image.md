# Aquarium image format

Reference: `GARbro/Legacy/Aquarium/ImageCP2.cs`, classes `Cp2Format`, `Cp2MetaData` and `Cp2Reader`. GARbro
commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/aquarium/cp2-image.ts` (`aquariumCp2ImageDescriptor`,
`aquariumCp2ImageFormat`, id `aquarium-cp2-image`, `readCp2Layout`, `readCp2Palette`, `unpackCp2Lz`,
`unpackCp2`).

The file begins with the word `CP2` — the word the reference registers — the width and the height stand at
four and eight as words, the depth at `0x0C` and the flags at `0x14` as words of their own. The four lower
places of the flags being anything but nought mean the pixels stand behind a walk of their own, and the place
`0x20` means a plane of fourth bytes stands behind them. Only the depths of eight, twenty four and thirty two
bits are read. A row of the picture stands on the next thirty two byte line, whatever is left of it standing
as it is, which is not the size a bitmap lays its own rows out with — so the port gathers the rows of every
picture it writes out into the size a bitmap does use.

An eight bit picture begins with its colour map of two hundred and fifty six entries of four bytes, and the
pixels stand behind it either as they are or behind a walk. The walk stands behind two words, the first of
which says how many bytes of the walk itself stand behind them: a byte other than nought stands as it is, a
byte of nought stands in front of a count and a place of two bytes — the place being how far behind the byte
being written the run it copies begins, which may reach into the run itself — and a count of nought stands for
a single byte of nought. The walk ends where the picture is whole or where the bytes it was told about run
out.

Where the flags say a plane of fourth bytes stands behind the pixels, that plane stands **one byte a pixel**
and is unwrapped the same way. The colour rows are then walked from the last of them to the first while the
fourth bytes are walked from the first, so the two planes stand in opposite row orders, and what comes out is
a picture of four bytes a pixel standing top down. A picture without that plane is handed out bottom up, which
is what the reference's own flip means.

The write path of the reference throws `NotImplementedException`, so this is a read only format. The place of
a run that reaches before the beginning of the pixels, and a run that reaches past the picture, are refused
with a message rather than reading or writing outside the array, which is all the reference's own copy would
answer with. The branch of the reference that reads a sixteen bit colour when it weaves the plane in is
unreachable — the reader turns a picture of that depth away before it gets there — and the port leaves it out.

The tests cover the head and the flags, the marks, depths and sizes it is turned away for, all four kinds of
step of the walk, a picture whose pixels stand as they are, one that stands behind a walk, an eight bit
picture with its colour map, a plane of fourth bytes woven into a picture of two rows in the opposite order,
the colour map as it stands, a walk that reaches behind the beginning of the pixels, and a file that does not
hold a picture.
