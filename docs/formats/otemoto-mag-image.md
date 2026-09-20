# Otemoto image format

Reference: `GARbro/ArcFormats/Otemoto/ImageMAG.cs`, classes `MagFormat` and `MakiReader`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/otemoto/mag-image.ts` (`otemotoMagImageDescriptor`,
`otemotoMagImageFormat`, id `otemoto-mag-image`, `readOtemotoMagLayout`, `readOtemotoMagPalette`,
`unpackOtemotoMag`, `otemotoMagIndexBytes`). Its words stand beside those of another engine's picture of the
same name, `banana/mag-image.ts`, so every one of them carries the name of the engine.

## The head

The reference registers the word `MAKI` and stands the picture behind the words `MAKI02  `, which stand in the
first eight places of the file. The words of the picture stand behind a place of their own, which stands as the
place `0x1A`: the places of that place name where the picture stands along its row and along its column and
where it ends, which stand as the width and the height of the picture, a place of the flags naming how many
places a place of the picture stands in — eight where the high place of those flags stands, and four where it
does not. Those words then name where the places of the palette, the words that name the places of the walk of
the picture, the places the walk reads, and the places the walk stands for itself stand.

`ReadHeader` stands every place the reference reads of a file at the head of the file rather than at the place
the reader stands at, so every place a word of the head names stands as a place of the file itself.

## The walk of the places of a picture

Every step of the walk names one place of a row of the picture by how far above the place that stands before it
it stands and how far beside it stands, or stands as a place the walk reads for itself where it names none. The
words that name the places of the walk stand in the places behind the head, every place of them naming eight
steps, and the words the walk stands for itself are read from the places the head names as the places the walk
reads.

## Deviations from the reference

- The reference names the places the walk reads by standing the place of the words of the head beside the words
  of the head that name those places, which reads that many places; this port reads the same places the same
  way, and pins what they stand as in a place of the test.
- The reference reads the places the walk asks for without reading how far the words of the head reach; this
  port turns a picture whose head, palette, words, or places stand outside the file away, where the reference
  would throw while reading them.
- A picture of no places, of no rows, and of more than two hundred and fifty six million places is turned away,
  and the walk of a picture that names a place outside the picture is turned away; the reference would throw
  while reading those.
- The places of the picture stand as the places of a bitmap and are handed out as a bitmap, which is what the
  reference hands to the caller that writes its pictures.

## Tests

`tests/formats/otemoto-mag-image.test.ts` covers the head of a picture and the heads it is turned away for, the
palette of a picture, the places of the walk of a picture and the places they stand as, the places a bitmap is
written with, a walk that names a place outside the picture, and the words of the picture. The picture of the
test stands worked out with a walk of the places of the reference's own, so its places stand under a walk this
port did not work out.
