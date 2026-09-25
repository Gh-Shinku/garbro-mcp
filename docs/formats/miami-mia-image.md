# Miamisoft image (MIA)

Reference: `Legacy/Miami/ImageMIA.cs`, class `MiaFormat` with the `MiaReader` beside it. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`. Implemented as `miami-mia-image`
(`packages/formats/src/miami/mia-image.ts`).

## The head and the colour map

The picture writes no word of its own: it is told by the shape of its head, which names its own kind of picture
far behind it. The head holds the places of its width and height, and its colour map stands in front of
everything else: sixteen colours of three bytes, green, red and blue to a colour, every byte of them spread over
the whole of the byte the picture is drawn with. The places of the picture are four bits each.

## The places of a picture

A picture is drawn a group of four places at a time out of a **frame** of its own, which stands of eight bytes
to a group - two of every one of them being the other one moved along - and is handed to the picture once it is
full. The bits of a picture name one of two things for every group:

* a group drawn out of the **pattern** of the picture, a table of its own where every place is worth the sum of
  the places it stands of: four places of the pattern are named, one behind the other, every one of them by how
  many bits stand clear in front of the next one that stands, and the place a picture draws out of the pattern
  is moved about within it so that the place behind it makes room for it;
* a group standing as the places of another one do, as many of them at once as the bits name, out of one of
  four places behind the group the walk stands at, or out of the group behind it with its places turned about
  two by two - the places of a picture standing one behind the other as the bits of its head name them.

A picture whose bits stand short of what the walk of it asks for is handed over as far as it was drawn, as the
reference hands it over.

## Deviations from the reference

* Every read is bounded by the file, and the places a group of the pattern reaches are held within it; the
  reference reads past both.
* Writing a picture is not implemented, as in the reference.

## Verification

Five tests over synthetic fixtures (`tests/formats/miami-mia-image.test.ts`): the head and the pictures it turns
away; a picture of nothing, whose groups are drawn out of places of the pattern that are worth nothing; the
places of a picture drawn out of the pattern of their own - one place of the pattern asked for by one bit
standing clear in front of the next one that stands, and the three places behind it standing where the walk has
reached - both as the frame hands them over and as a bitmap holds them; the colour map of a picture, green, red
and blue to a colour; and a picture told by the shape of its head alone.

The groups standing as the places of another one do - out of the four places behind the group the walk stands
at, and out of the group behind it with its places turned about - stand in the port as they stand in the
reference, but no fixture of them was finished here: of a picture of this engine such a group stands as the
group beside it does within the frame, so the two readings of it are not told apart by a fixture; they stand
among the places still to be verified of the record of this format.
