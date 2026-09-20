# Leaf resource archive

Reference: `GARbro/ArcFormats/Leaf/ArcLEAF.cs`, classes `LeafPackOpener`, `LeafArchive` and `LeafPackScheme`.
GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/leaf/pak.ts` (`leafPakDescriptor`, `leafPakFormat`, id `leaf-pak`,
`readLeafPackLayout`, `decryptLeafPlaces`, `encryptLeafPlaces`), with the fixed entry helpers of
`packages/formats/src/shared/fixed-archive.ts`.

The reference registers the word `LEAF` and no name at all.

## The head

The word `LEAF` stands at the beginning of the file with the word `PACK` behind it, how many files the archive
places for every file, which stands as the length of the file less the length of the walk.

## The walk of the names

A file of the walk names eight places of a name and three of an extension, every place behind the name
standing as nothing, and the name standing as the name of the file with the extension behind it where the
apiece behind those.

the places are longer than it.

The key of the reference stands for every title in its own list of games, and in its own settings where it
knows no title; this project carries neither, so the key the reference names first stands as the key of this
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

## Tests

more files than it holds, a file that stands outside the archive, a name that does not stand as the name of a
file, the files of an archive stood in the clear, and the finding of an archive of its own kind. The archive of
the test stands worked out with a walk of the key of its own, so its places stand under a walk this port did
not work out.
