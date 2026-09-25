# ADVIZ engine image (GIZ3)

Reference: `Legacy/Adviz/ImageGIZ.cs`, class `Giz3Format` with the `Giz3Reader` beside it. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`. Implemented as `adviz-giz3-image`
(`packages/formats/src/adviz/giz3-image.ts`), beside the other pictures of the same engine (`adviz-giz2-image`,
`adviz-biz-image`, `adviz-biz2-image`).

## The head

The picture opens with its own word, then where it stands inside the screen it was drawn on - a place counted
eighty pictures to a row and eight places to a byte, which the head holds as one word - the strips it is made
of (eight places to a strip), how many rows it has, whether it carries a colour map of its own, and the map of
its planes. A picture of this engine is always four places to a byte.

## The places of a picture

The places stand in a ring of four strips of four planes, a plane of a strip at a place of its own. The walk
takes the strips of the picture one after the other, and every strip twice: its **first half** writes the four
places above the second, its **second half** the four below. Of every four planes, the ones the map of the
planes **does not** name are read out of the bits of the picture; the ones it names stand as the strip before
them left them.

A plane is written with tokens of its own: a token below sixteen stands for one place, and a token of sixteen
or more names a **run** whose way and whose length follow it. A run of way zero writes places of nothing, one
of way one places of fifteen, the ways above them copy places the plane has already written - two places back,
one place back, or the planes behind the one it stands in, three of them - and the last two ways copy the
strip before the one the walk stands in, which is how a picture reaches the places it drew a moment ago. A run
the reference draws nothing for steps over its places and reads the next token.

The two halves of a strip - and every one of the four planes in each of them - are then drawn together into
the places of the picture: the first half names the place above the second, and every place of the picture
stands in a bit of its own of the plane the map of the places names.

## The tree of the tokens

The words of a picture open with the length of the tree of its tokens, and every three bytes behind it hold two
of its nodes. A node whose highest bit is set stands for a token; one that is clear stands for the place of a
record of its own within the tree, counted from the second node, so that the two children of a node stand side
by side. The root of the tree is the second node from its end. The bits behind the tree are read from the
**highest** bit of a word down, a word being the two bytes of it the other way round.

## The colour map

A picture that carries a colour map of its own holds sixteen colours of three bytes each - blue, red, green -
with every byte spread over the whole of the byte it names. A picture that carries none falls back on the
sixteen places of grey the reference's own viewer hands it; the colour map of the game such a picture belongs
to stands in a table beside it, which the reference does not read either.

## Deviations from the reference

* Every read is bounded by the file; the reference reads past it and draws whatever stands there.
* A tree the file does not hold in full, or a token whose bits run out, is refused.
* Writing a picture is not implemented, as in the reference.

## Verification

Six tests over synthetic fixtures (`tests/formats/adviz-giz3-image.test.ts`): the head, its place on the screen
and the pictures it turns away; a picture whose places all stand still, which is drawn as nothing at all; the
tree of two tokens and the codes it stands for; a place of its own written into both halves of a strip, with
the places of the picture drawn out of them - the expectation of which was worked out by hand from the
reference's own arithmetic, and which corrected the port's first reading of it; a run of nothing and a run
that reaches back into the places the plane has just written; and the colour map of a picture, both the one it
carries and the grey one it falls back on.

The fixtures write the tree of the tokens the other way round from the reader - the nodes laid out so that the
two of a node stand side by side and the root stands last - which is a mirror of the reader's own rules.
