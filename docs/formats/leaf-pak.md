# Leaf resource archive

Reference: `GARbro/ArcFormats/Leaf/ArcLEAF.cs`, classes `LeafPackOpener`, `LeafArchive` and `LeafPackScheme`.
GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/leaf/pak.ts` (`leafPakDescriptor`, `leafPakFormat`, id `leaf-pak`,
`readLeafPackLayout`, `decryptLeafPlaces`, `encryptLeafPlaces`), with the fixed entry helpers of
`packages/formats/src/shared/fixed-archive.ts`.

The reference registers the word `LEAF` and no name at all.

## The head

The word `LEAF` stands at the beginning of the file with the word `PACK` behind it, how many files the archive
holds stands in the word at `0x08`, and the walk of their names stands at the end of the file: four and twenty
places for every file, which stands as the length of the file less the length of the walk.

## The walk of the names

A file of the walk names eight places of a name and three of an extension, every place behind the name
standing as nothing, and the name standing as the name of the file with the extension behind it where the
extension holds any places at all. The places of the file and how many places it holds stand four places
apiece behind those.

## The walk of the places

Every place of the walk of the names and every place of every file stands under the walk of the key of the
title, which stands as the places of the reference's own key for that title: every place stands less the place
of the key that stands at the same place of the key's walk, and the walk of the key stands over and over where
the places are longer than it.

The key of the reference stands for every title in its own list of games, and in its own settings where it
knows no title; this project carries neither, so the key the reference names first stands as the key of this
port. An archive of another title therefore stands under the wrong key, which the walk of the names and the
places of the files tell apart: a name that does not stand as the name of a file, and a file that stands
outside the archive, both leave the file to the kinds that read it otherwise.

Every file of an archive stands under its own walk of the key, which begins again at the front of the file,
which is what the reference stands when it reads a file of the archive.

## Deviations from the reference

- A file of fewer than ten places, a file that does not hold the words of the format, an archive that names no
  file or as many files as the reference stands as mad, an archive whose walk of the names does not stand
  whole in the file, a name that does not stand as the name of a file, and a file that stands outside the
  archive are turned away; the reference would throw while reading its head, or would hand out a walk of names
  that stands under the wrong key.
- The reference stands the key of a title in its own list of games and reads a file of an archive it does not
  know with the key of one of its own titles; this port stands the same key, which is what the titles of that
  list the reference names first stand under.
- A file of an archive stands in the clear as its places stand, the archive standing behind no walk of the
  LZSS kind, which is what the reference hands out.

## Pictures of the archive

An entry the index names `.tga` stands of a picture of that kind with two places of its head left as the
engine stood them: a picture of no places of a colour of a place stands of two and thirty of them, and a
picture of that many places of a colour of a place stands of eight places of the alpha of a colour.
`PakOpener.OpenImage` puts those two places right — the count of the places of a colour of a place at `0x10`
and the count of the places of the alpha of a colour at `0x11` — hands the stream to the reader of that kind
of picture, and hands it to the decoder of the platform where that reader fails, which reads every kind of
picture it knows.

This port puts the same two places right and reads the picture with its own reader of that kind of picture,
handing out a bitmap; where that reader fails it reads the JPEG and PNG interchange formats, and an entry
whose places are in none of those kinds stands handed out as it stands. The name of the entry stands as the
index of the archive stands it, which is what the reference reports as well.

## Tests

`tests/formats/leaf-pak.test.ts` covers the walk of the places and the walk of the key standing over and over,
the walk of the names of an archive, the words a file is turned away for, an archive that names no file or
more files than it holds, a file that stands outside the archive, a name that does not stand as the name of a
file, the files of an archive stood in the clear, a picture of the kind the entries hold whose head stands of
the two places the engine left out, an entry of that name whose places are in no picture format this port
reads, and the finding of an archive of its own kind. The archive of
the test stands worked out with a walk of the key of its own, so its places stand under a walk this port did
not work out.
