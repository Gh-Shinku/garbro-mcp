# TechnoBrain Inteligent Picture Format

Reference: `GARbro/ArcFormats/TechnoBrain/ImageIPH.cs`, classes `IphFormat` and `IphReader`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/techno-brain/iph-image.ts` (`technoBrainIphImageDescriptor`,
`technoBrainIphImageFormat`, id `techno-brain-iph-image`, `readIphLayout`, `unpackIph`).

## The head

word of its own, so that a sound of the kind that stands as the words of the RIFF kind stands as no picture.
The reference refuses such a sound by the words of the head rather than by those words: the head of a picture
place of the words or as nothing stand at eight, the words `fmt ` at `0x0C`, the words `bmp ` at `0x38`, and
the words of those last name how much of the picture stands, how wide and how tall it stands, how many places a
place of it stands in, and whether it stands walked of its own.

## The places of a picture

The places of a picture stand behind the words of its head, at `0x58`. A picture that stands as it stands hands
every place over as it stands. A picture that stands walked of its own walks every row of its own, every step
of the walk standing as a place of the walk that stands as it stands, as a place that stands as many places of
the picture beside it, or as a place that stands beside the place before it by how much its places of a colour
the places that name how much of a place of the picture stands on the places beside it, which stand as places
of a walk of their own, and a row whose places stand as no places of a walk at all stands as it stands.

## Deviations from the reference

  so a walk of a row may stand into the row behind it; this port reads the same places the same way, and turns
  a walk whose places stand outside the file away where the reference would throw while reading them.
  any but four and twenty of them away while reading its places; this port reads a picture of that number of
  picture of no places of a colour this project reads.
  picture reach; this port turns a picture whose places stand outside the file away.
  places a place, which is what the reference hands to the caller that writes its pictures.

## Tests

`tests/formats/techno-brain-iph-image.test.ts` covers the head of a picture, the heads it is turned away for,
picture of places a colour this project does not read, and the words the picture is told by. The picture of the
port did not work out.
