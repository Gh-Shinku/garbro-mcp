# Studio Jikkenshitsu picture of the kind its own places stand as

Reference: `GARbro/ArcFormats/StudioJikkenshitsu/ImageGRC.cs`, classes `GrcFormat` and `GrcReader`. GARbro
commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/studio-jikkenshitsu/grc-image.ts`
(`studioJikkenshitsuGrcImageDescriptor`, `studioJikkenshitsuGrcImageFormat`, id
`studio-jikkenshitsu-grc-image`, `readGrcLayout`, `decodeGrc`), with the bitmap writers of
`packages/formats/src/shared/bmp.ts`.

The reference registers the place `08` and the word `0x8008`, which begins with it, and the name `grc`; a
picture is read only where its name stands as the name of such a picture.

## The head

The places of a colour of the picture stand in the place at the front of the head, and the highest place of
the place behind it names whether the places of the picture stand under the cipher. The reference reads a
picture of eight bits and no other. The width of the picture stands in the words at `0x04` and its height in
the words at `0x06`, where the places the walk names stand in the words at `0x08` and `0x0C`, where the places
of the picture that stand as they stand do in the words at `0x10` and `0x14`, and where the places of a shape
of the picture stand in the words at `0x18` and `0x1C`, which the reference keeps and does not read.

Behind the head stand the colours of the picture — four places a colour, its blue, its green, its red and a
place that counts for nothing — and behind those stands one place for every row of the picture, naming which
of the four ways the steps of the row stand.

## The walk of the places

A row of the picture stands behind places of the rows before it, and the place of the row names which of four
ways the steps of that row stand:

| the place of the row | the places a step of the row stands behind |
| -------------------- | ------------------------------------------ |
| nought | the place before the step, the place of the row before at the place of the step, and the place before that one, in that order |
| one | the three places before the step, in that order |
| two | the place of the row before at the place of the step, and the two places of the two rows before it, in that order |
| three | the place of the row before behind the step, at the place of the step and before it, in that order |

Every step of four places stands behind one place of the walk of the steps, the four places of a step standing
four pairs of places of it, the highest pair first. A pair that stands at nought names a place of the picture
as it stands, which stands behind the places of the picture that stand as they stand; every other pair names
which of the places above the place stands in it.

## Deviations from the reference

- A file of fewer than two and thirty places, a file whose places of a colour stand beside anything but eight,
  a picture of no places or of a number of places that stands beside four, a picture of more places than this
  project will hold, and a picture whose walks stand outside the file are turned away; the reference would
  throw while reading its head.
- A picture whose places stand under the cipher is turned away, the key of such a picture standing in the
  reference's own settings, which this project does not carry.
- A row whose place names a way the walk does not know, a walk that stands short of its own places, and a step
  that names a place that does not stand before it are refused with a message, where the reference reads past
  the places of its own stream.
- The places of a shape of a picture are kept as the reference keeps them and are not read, the reference
  keeping them in its own head without reading them either.
- The places of a picture stand as a bitmap of eight bits, the picture standing the other way up from the
  places of the file.

## Tests

`tests/formats/studio-jikkenshitsu-grc-image.test.ts` covers the head and the words it is turned away for, a
picture whose places stand under a key of its own, a picture whose walk stands outside the file, a picture
whose four rows stand the four ways of the walk in turn, the colours of a picture, the bitmap a picture hands
out, and the finding of a picture only where its name stands as the name of such a picture.
