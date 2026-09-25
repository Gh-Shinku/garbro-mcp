# Key compressed image

Reference: `ArcFormats/Key/ImageCZ.cs`, class `CzFormat` with the `CzDecoder` beside it. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`. Implemented as `key-cz-image`
(`packages/formats/src/key/cz-image.ts`).

## The head

The picture opens with the two letters `CZ` and the character that names its version, and the head holds where
it ends at 4, the width and the height, and the depth. A head longer than twenty four bytes also names where
the picture stands on a larger canvas. The reference **lists** three words for detection - `CZ0`, `CZ1` and
`CZ3` - while its own reader knows the second version as well, so a `CZ2` file is told by the name it carries
and this port keeps the same split: the three words are declared as signatures with the extension as a
fallback, and the head itself asks only for the two letters and a version character between zero and three.

Only two depths are drawn: eight bits through a colour map and thirty two bits as four bytes a pixel. The map
stands red first, as the reference reads it, and a bitmap keeps blue first, so the two ends of every colour are
exchanged on the way. A picture of twenty four bits is **refused by name**: the reference would lay out three
bytes to the pixel and then hand them over as though they were four.

## The parts

The three newer versions keep their pixels in parts. The head of the table says how many parts there are, and
every part names its stored length **in whole pixels** - which the reference doubles to reach bytes - and the
length it unfolds to, which it never looks at. The bodies of the parts follow the table, one behind the other,
and they share the place the picture has reached: what one part draws is what the parts behind it copy from.

A part is a line of pairs. The **low** byte of a pair is a value and its **high** byte is a control:

* a control of nothing stands for the value itself, one byte of the picture;
* any other control names the **range** that stands at a place of the part - the word of the pair counted from
  0x101, in whole pixels - and drawing it draws two bytes.

A range is two pairs that stand one behind the other, and each of them is either a byte of its own or another
range in turn, so a part is a tree of ranges. What a range drew is remembered by the place of the pair that
named it, so a part that names the same range twice draws it once - the second time the bytes are copied over
from the picture with the progressive copy the project shares. Two places of the reference are kept as they
stand: the second byte of a range comes from the byte the range itself drew first when its own place is named,
and a byte behind a chain of copies is followed to the end of that chain.

## The rows behind the pixels

The third and the second version add the rows of the picture up again after the parts are drawn: one row in
every `(height + 2) / 3` stands as it is, and every other row carries the row behind it added on - a byte at a
time for the third version and a whole word at a time for the second, where a carry out of the word is lost
rather than left in the byte behind. The oldest version stores its pixels as they stand, with no parts at all.

## Deviations from the reference

* Every read is bounded by the file: a part table, a part and a copy that name a place outside what the file
  holds are refused rather than read past.
* A chain of copies that turns on itself or runs deeper than thirty two steps is refused; the reference
  follows such a chain until its own stack runs out.
* A picture whose head names more than sixty five thousand parts is refused.

## Verification

Seven tests over synthetic fixtures (`tests/formats/key-cz-image.test.ts`): the oldest version with its colour
map, which also pins that the map reaches the bitmap blue first; a part of bytes that stand as they are; a pair
that copies a range and a second pair that copies the same one; a copy whose range is itself a copy, which
walks two of them; the rows of the third and the second version, where the second is pinned by a **carry** that
a byte at a time would have left behind; a depth the reference cannot draw and a part table that reaches past
the file; and a word the head does not know with a copy that names a place outside its part.
