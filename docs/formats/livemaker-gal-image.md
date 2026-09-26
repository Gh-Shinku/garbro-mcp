# LiveMaker image (`GAL`)

Reference: GARbro `ArcFormats/LiveMaker/ImageGAL.cs` — classes `GalFormat`, `GalReader`, `Frame`, `Layer` —
at GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License, over the generator `TpRandom` of
`ArcFormats/LiveMaker/ArcVF.cs`.

A picture of the engine stands of a head of two shapes, of the counts of a frame, and of the counts of the
places of that frame.

## The head

Every picture begins with the word `Gale`, the three letters of the version (`100` to `107`), and then,
for the versions of the count of one hundred and three and above, the counts of the places of the head of it:

| offset | field |
| --- | --- |
| 0 | the word of the version, which stands of the letters as well |
| 7 | the size of the head, before the letters of the version |
| then, within the head of the picture | |
| 4 | the width |
| 8 | the height |
| 0xc | the count of the places of a colour |
| 0x10 | the count of the frames |
| 0x15 | a count of no places at all where the places of the picture stand plain |
| 0x16 | the kind of the walk of the places of the picture: no count for the walk of the engine of the counts of the places of the picture itself, one for the places of the picture as they stand, two for the kind of the engine itself |
| 0x18 | a count the reference reads and stands of no place |
| 0x1c, 0x20 | the width and the height of a count of the places of the picture, where the places of the picture stand of the walk of the engine of the counts of the places of it |

The versions of the count of one hundred and two and below stand of the counts of the picture of the engine
alone, and the places of the picture stand of the count of the places of the head of it.

## The counts of the frame

The places of the picture begin at the place the head names: the size of a name and the name, a count the
reference reads and stands of no place, nine bytes of no count, the count of the counts of the places of the
picture, and then the counts of the frame: the width, the height and the count of the places of a colour. A
picture of a count of eight places of a colour and below stands of the counts of the places of a colour of its
own, four places of every one of them, in the order of the counts of the places of the picture of the engine
(`BgrX`: the places of the counts of the picture of the engine, then the places of the colour of the walk of
the engine itself).

Every count of the places of the picture then stands of the places of it within the picture, the counts of the
walk of the engine of it, the name of it, and then the places of it: the size of the places and the places,
and then the size of the counts of the places of the engine of it and those places, where they stand.

## The walk of the places of the picture

For the versions of the count of one hundred and three and above the places of a count of the places of the
picture stand of the walk of the engine of the places of the picture of the engine itself, and for the older
versions they stand as they are.

* The walk of the engine of the counts of the places of the picture itself. The places of the picture are a
  stream of the counts of the places of a block of the walk of the engine: every count of them is a pair of
  counts, one for the count of the places of the picture and one for a place of a count of the places of the
  picture of the engine. A count of no places at all of the first count names the places of the picture as
  they stand in the stream; a count of one place behind no place at all names a count of the places of the
  picture of the engine within the same frame, of the places of the picture of the engine that stand before
  it; any other count names the count of the places of the picture of a frame of the engine and the count of
  the places of that frame, which is how the counts of the pictures of the engine stand of one another. Where
  a picture stands of no count of the places of a block of the walk of the engine itself, the places of the
  picture stand of the counts of the places of the picture alone.
* The walk of the engine of the counts of the places of the picture of the picture. Where the head names it,
  the counts of the places of the picture stand of the generator of GARbro (`TpRandom`): the counts of the
  places of the picture or of its blocks are named one by one by a count the generator gives, which is taken
  from the counts of the places that stand behind it, and the count that stands at the place the generator
  names is the count that stands next in the stream. The reference stands of the key of the game, which its
  own counts hold as no key at all; a generator of no key at all gives a count of no places at all for the
  first count and therefore names the counts in the order they stand in, so a picture of the engine of no
  key at all stands of the places of the picture as they stand in the file.

## The places of the picture

The places of one count of the places of the picture stand as the picture of the engine: a picture of no
counts of the places of the engine of it stands of the places of a colour as the file gives them, and a
picture of the counts of the places of the engine stands of the four places of a colour of the walk of the
engine of this project. The reference names the walk of the places of the picture itself for the places of a
picture of the kind of the engine, which this port has not taken: such a picture stands detected, and the
places of it stand refused.

## Deviations

* The port reads the counts of the head and of the frame of the picture before it stands of the places of the
  picture, as the reference does, so a picture of a kind this port has not taken stands detected and is
  refused where its places stand read.
* Only the first frame of a picture of the engine stands read, as the reference does: the reference reads the
  places of the frames behind it and stands of the first one alone.
* The port stands of the key of no places at all for the walk of the counts of the places of the picture,
  which is what the reference does with the counts of its own: `QueryKey` answers no key at all where the
  counts of the engine hold none.
* A picture of a count of sixteen places of a colour of the walk of the engine stands of the walk of the
  counts of the places of the picture of the engine of this project, so the counts of the places of the
  picture stand of the counts of the places of a colour of the walk of the engine.
* The reference reads the counts of the picture of the engine of the older versions of the engine at places
  of its own, behind the counts of the head of the picture, and those counts need not stand of the counts of
  the frame of the picture itself. The port names the counts of the frame, which the places of the picture
  stand of.
* The places of a picture of the engine stand of a bitmap of the walk of the engine of this project: a count
  of eight places of a colour of the walk of the engine stands of the counts of the places of the picture of
  the engine, and a count of sixteen places stands of the counts of the places of a colour of the walk of the
  engine itself.

## Tests

`tests/formats/livemaker-gal-image.test.ts` builds pictures in the test:

* the head of a picture of the count of one hundred and seven, the counts of the frame of it, the path of the
  places of the picture the port hands out, and the places of the picture of the engine, which stand of the
  counts of the places of the picture itself, so the counts of the places of the picture stand of the counts
  of the places of the walk of the engine of the picture of the engine,
* the head of the count of one hundred and two, without the counts of the walk of the engine of the places of
  the picture, of a count of eight places of a colour, and the counts of the places of the picture of the
  engine of the walk of the engine of the picture,
* the counts of the places of a picture of the engine that stand of the counts of the places of the picture
  itself and of the counts of the places that stand before them,
* the count of the counts of the walk of the engine of the places of the picture (`readGalSequence`), which
  stands of the generator of GARbro, and the count of no places of a picture of the engine at all, which
  stands of the order the counts stand in,
* the counts of the places of a picture of the engine of the walk of the engine of the picture (the kind of
  the walk of the engine of the counts of the places of the picture of the engine itself),
* the refusals: a word of another picture, a count of the walk of the engine outside the counts of the
  engine, a count of the places of the head of the picture of the engine of another count of the walk of the
  engine, a picture of no count of the places of the picture of the engine at all, and the places of a
  picture of the kind of the engine itself.

## References

- `GARbro/ArcFormats/LiveMaker/ImageGAL.cs` — `GalFormat.ReadMetaData`, `GalFormat.Read`, `GalReader.Unpack`,
  `GalReader.UnpackLayer`, `GalReader.ReadBlocks`, `GalReader.ReadRaw`, `GalReader.ReadZlib`,
  `GalReader.ReadJpeg`, `GalReader.Flatten`, `GalReader.ShuffleBlocks`, `GalReader.RandomSequence`
- `GARbro/ArcFormats/LiveMaker/ArcVF.cs` — `TpRandom`
- `GARbro/GameRes/Image.cs` — `ImageFormat.ReadColorMap`
