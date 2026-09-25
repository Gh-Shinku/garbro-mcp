# BOM GRP picture (`GRP/RG`)

Format reference: GARbro `Legacy/Bom/ImageGRP.cs` (`GrpFormat`, `GrpReader`), GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

## Head

The picture starts with a mark of `RG` and a word (`0x52`, `0x47`, `0x01`, `0x00`), and a head of `0x24`
places holds the kind of the picture, the box, the places of a row and the place of the walk:

| offset | field |
| --- | --- |
| 0 | the mark `RG\x01\x00` |
| 4 | the kind of the picture: 1 to 5 |
| 6 | a word whose **top place must be set** |
| 8 | the width and the height (`u16` each) |
| 0x18 | the places of a row of the picture (`i32`) |
| 0x22 | the place of the walk (`u16`) |

The kind stands for the places of a colour of the picture: 1 is thirty two, 2 twenty four, 3 sixteen, 4
eight and 5 four.

## The places of the picture

A word at the place of the walk tells whether the walk is there at all: a word whose **top place is set** is
followed by the places of the picture **as they stand**, of the count the head names. Otherwise the walk
behind the word turns them out, and the reference reads the count of that word and does not stand on it: the
walk ends of the places of the picture alone, so this port does the same.

## The walk

The walk stands of a frame of four thousand places, of which the three thousand and sixteen at the front
are a space and the sixty four behind them are nothing, and it starts at the end of the spaces. Every step
of it is a **control** the tree of the walk names:

* a control below `0x100` is a place of the picture of its own;
* a control of `0x100` or above stands for a **run**: its count is the control less `0xFD`, so a run is of
  three places up to sixty four of them, and the place it reaches back to stands behind it, of twelve
  places, which the walk reads of a place of its own and of one up to six places behind it.

Every place a run brings is written into the frame as well, at a place that runs on from the end of the
spaces and turns over at the end of the frame, which is what lets a run reach the places it has turned out
itself.

## The tree of the walk

The codes the walk reads stand of an **adaptive Huffman tree** of 318 leaves (the places of a picture and
the sixty two counts of a run), which the reference fills itself:

* `dword_6FF464` holds the weights of 636 places, of which the first 318 stand of the leaves and of the
  rest hold the weights of the inside places, with `0xFFFF` behind the last of them, the root;
* `dword_703E68` holds the links of 635 places: the two places behind a place are the link of it and the
  one behind that, the first for a place of the code that stands at nothing and the second for one that
  stands;
* `dword_70986C` holds the place above each of 953 places, of which the leaves make the last 318.

The code of a place is read from the link of the root down, a place of the code at a time, until a link
stands at a leaf, which is the place itself. The walk starts at the **link of the root** - the first place
of every code is taken - and then reads a place of the code for every step.

Behind every place of the picture the tree is **rebuilt**: the walk from the leaf of that place up to the
root bumps the weight of every place it passes, and a place whose weight stands above the weight of the one
behind it is swapped with the highest place whose weight stands below it, links and all. A table of the
parents is filled again from the links at the end of it. When the weight of the root reaches `0x8000` the
whole tree is halved first: the links of the leaves are gathered to the front of the table, the weights of
them are their own halved with the low place lost, and the inside places are built again in the order of
their weights, of the tops of the two behind each of them.

## The run of the places behind the walk

Every place the walk turns out is handed to a **second** walk of its own, which the reference writes out
over the places of the picture in a single place:

* the first place stands in front of the walk;
* a place equal to the one in front of it **begins a run**, whose count of places behind it is read of the
  seven lowest places of each of the places behind that, and a set top place says that another one follows;
* any other place hands the place in front over once and stands in front itself.

The reference never hands the place that stands in front at the end of the walk over, nor a run that is
still open, so a picture can end short of its own size; the places behind what the walk turned out keep the
zeros the picture was built of.

## Deviations

* A picture of no width, of no height, of no places in a row, or one whose walk stands past the end of the
  file, is turned away rather than read past the end like the reference would.
* A picture whose walk reads past the end of the packed places reads a place of nothing for every place it
  is missing, which is what the reference does as well, since it hands a place of nothing back for a read
  that stands past the end.
* The kinds of four and of eight places a colour carry no palette, and the reference hands a picture of
  either over as `Gray8` of the places as they stand, places of a row included. This port writes the same
  places into a picture of eight places a colour, of a width as wide as the places of a row of the head and
  of the height of the picture, since a picture of four places a colour stands of **packed** places that
  the reference would show one to a place.
* The places of a picture whose count of places in a row of the head stands above the place one of its
  format names are gathered to a picture of the places of its format, so that a picture of a padded row
  turns into a bitmap of its own width; a narrower row behind it keeps the places of nothing.

## Tests

`tests/formats/bom-grp-image.test.ts` pins the head, the kinds of it (of thirty two places of a colour down
to four), the word whose top place must be set and the turning away of a file that stands short of its
head.

The places of a picture of the walk are checked against streams written off the reference on their own: a
reading of `GrpReader` with a writer of the bits the walk reads from the highest place of a byte down, of
the code of a place in the adaptive tree and of the update of that tree behind every place. The places the
walk turns out are read off the steps of every stream by hand, which the comments of the tests write down:

* a picture of twelve places of seventeen places of its own, of two values one after the other, so the walk
  hands a place over only when the one behind it is another one and the last of them is dropped;
* a picture of forty four places whose first step is a run of three places of the frame that reaches back
  to the last place of a space: the three spaces begin a run of the places behind the walk, whose count of
  thirty two hands thirty two spaces over before the places of the stream follow;
* a picture of twenty eight places whose run reaches back to the places it has written itself, of three
  places, of which the last stands of the two in front of it.

A picture of its places as they stand, the bitmap of the format of a picture of three places a colour, one
of two places a colour and one of eight places a colour are pinned beside them.
