# Ark image format

Reference: `GARbro/Legacy/Ark/ImageCMP.cs`, classes `CmpFormat`, `CmpMetaData` and `CmpReader`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/ark/cmp-image.ts` (`arkCmpImageDescriptor`, `arkCmpImageFormat`, id
`ark-cmp-image`, `readCmpLayout`, `buildCmpTree`, `decodeCmp`), with the bit reader of
`@garbro-mcp/codecs` (`MsbBitReader`) and the bitmap writer of `packages/formats/src/shared/bmp.ts`.

The reference registers no word of its own and reads a picture of this engine only where the name of the file
ends in `cmp`.

## The head

The width of the picture stands in the word at nought and its height in the word behind it. Where the byte at
four stands, the words behind it are the width and the height of the shape of the picture — which the walk of
the picture does not read, and which the port carries in the head of the entry alone. Thirty two weights then
stand behind that, saying how often every place of the picture is walked, and the size of the walk of codes
closes the head. The walk has to reach from behind the head to the end of the file.

## The tree of codes

behind them as many places as stand between thirty two and two hundred and fifty five, weighing nought apiece.
The two places that weigh the least are then joined again and again — where several weigh the same, the last
of them in the order they stand in — until one place is left, which is the root of the tree; the first of the
two places joined is its left and the second its right.

## The walk of the picture

and high, and a place of the picture is walked out of the tree of codes a place at a time: a place of the walk
that stands takes the walk to the left and a place that does not takes it to the right. What a place of the
tree gives is not the place of the picture itself but how far it stands behind the place before it, the places
running all the way round from the last of them to the first.

Every place of a colour is then taken from the three planes — five places of blue, then five of green and five
of red — and the rows of the picture stand from its bottom edge up, which the port keeps by writing a bitmap
whose rows run the way they are walked.

## Deviations from the reference

- A file of fewer than five bytes, a file whose width or height does not stand above nought or whose picture
  stands beyond what this project will hold, a file whose head does not carry the thirty two weights and the
  size of the walk, and a file whose walk does not reach from behind the head to the end of the file are turned
  away; the reference would throw while reading its head.
- A walk that runs out of the file is refused with a message, where the reference reads beyond the file and
  throws; a walk that reaches a place of the tree that stands between thirty two and two hundred and fifty four
  is refused with a message, where the reference reaches for the children of a place that has none.
- The reference leaves the writing of a picture out; the port writes a bitmap of sixteen bits with the five
  places of every colour in the places GARbro itself gives them.

## Tests

`tests/formats/ark-cmp-image.test.ts` covers the head, the shape of a picture behind it, a walk that does not
two places of width, a picture written out as a bitmap of sixteen bits, a file whose name is not `cmp` and a
file whose walk does not reach the end of the file. The vectors are worked out by hand: where every place but
the thirty first weighs nought, that place stands one bit away from the root, and a walk of six nought places
gives the places 31 and 30, 29 and 28 and 27 and 26 of the three planes, which are the colours 28607 and 27550.
