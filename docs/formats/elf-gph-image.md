# Elf GPH picture (`GPH`)

Format reference: GARbro `ArcFormats/elf/ImageGPH.cs` (`GphFormat`, `GphReader`), GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

## Head

The file starts with the letters `GPH` and the byte `0x1D`, then

| offset | field |
| --- | --- |
| 4 | the count of the frames of the file (`u16`) |
| 6 | the place of the first frame (`i32`) |

A count of no frames, or a place of a frame beyond the file, is turned away. The reference reads the first
frame of the file alone, however many it names.

## The frame

At the place of a frame:

| offset | field |
| --- | --- |
| 0 | the count of the places of the frame (`i32`), which this port reads but does not stand on |
| 4 | the flags (`u16`); the bit of four places says the frame carries no palette of its own |
| 6 | the palette of the frame, sixteen colours of two places, unless that bit stands |
| | the box of the picture: the left, the top, the right and the bottom (`i16` each) |

The box is read after the palette when the frame carries one. The left and the right are doubled and the
right and the bottom are taken one above, so the width of the picture is `(right + 1) * 2 - left * 2` and
its height `bottom + 1 - top`. A frame that names no place of a picture is turned away here rather than
read as a picture of no places.

A palette of the frame is read as sixteen pairs: the red of a colour out of the second and the third place
of its first byte and its blue out of the third and the fourth, and its green out of the second and the
third of its second byte. Every one of them is six places wide and is lifted into eight by
`colour * 255 / 60`, cut down to a byte.

## The two trees

The places of a frame stand behind its box, and in front of them stand two Huffman trees of the engine, one
of the tokens and one of the places of the window a run reaches back to. Both are read from the same stream
by a reader of its own:

* the reader holds sixteen places of the stream at a time and takes a byte at a time as it goes, most
  significant bit first; the first two places of a walk stand behind the box of the frame;
* a step of a tree takes one place of the stream. A set place is an inner node of two children and a clear
  one a leaf, whose value is the next nine places of the stream for a token and the next eight for an
  offset;
* the token tree takes one more place of the stream for a leaf than the offset tree does. That is the only
  place the two trees of the reference part, and it is a place a port can slip on: the offset leaf reads
  its value and then shifts the window by eight places, where the token leaf shifts by nine;
* the nodes of the two trees share one table: the token nodes stand from its start and the offset nodes
  from 0x400, a leaf of either tree being a value below its own root (0x200 and 0x100);
* the codes are then read off the trees for every prefix of eight places of the stream (`ProcessTokenNode`
  and `ProcessOffsetNode`): a walk takes the eight places it holds as the index of two tables of lengths
  and tokens and steps on from there a place at a time.

## The places

A token below 0x100 is a place of the picture itself. A token above it is a run whose count is its low byte
plus three, and the place it stands on comes from the second walk: the code of that walk is turned by a
table of 0x100 words into a distance, which is one above the code for a stride of sixteen or less and
otherwise walks the four bit places of the frame row by row. The places themselves stand in a window of
0x1400 bytes; a run that reaches before the start of the window wraps to its end, and a window that fills
is walked into the picture.

The picture is four bits a place. The walk of a window place into a place of the picture is a walk of the
four bits of it in their own order: the first place of the byte is the highest place of the picture and the
second the one behind it, so a row of the output is half the width of the picture and its stride is the
width of it halved, a fraction of a place being dropped.

## Deviations

* A frame whose box names no places of a picture, or a place of the places of a frame beyond the file, is
  turned away as a broken picture, where the reference builds an array of its stride and height as they
  stand and lets its own walk fall over. A guard stands where the reference would throw.
* The count of the places of a frame (`frame_length` at the head of it) is read and reported, but the walk
  of the reference does not stand on it: the walk ends of the count of the places of the picture alone, so
  this port does the same.

## Tests

`tests/formats/elf-gph-image.test.ts` writes the stream of the format with a bit writer of its own, most
significant bit first, and first asserts that the stream it writes is the one the reader of the reference
takes. The token tree of the fixture holds a place of its own of two kinds and two runs (of three places and
of four) and its offset tree two distances (of one place and of two), and the tokens that follow walk them
in a pattern whose places are known: two places of their own, a run of four that reaches two places back,
and runs behind it.

The places the walk turns out are then the values the tokens ask for, packed the way the format packs them
— a table of the same packing stands in the test beside the walk — so a slip in either tree, in the walks,
in the window or in the packing shows up as a difference rather than as a picture that merely looks wrong.

The head of the picture, the palette of a frame that carries one, the sixteen colours of the engine, the
bitmap the format hands over (its two headers, its palette and its top down rows) and the turning away of a
mark of another engine, of a count of no frames, of a place of a frame beyond the file and of a box of no
places are pinned beside it.
