# RPG Maker engine image format

Reference: `GARbro/Experimental/RPGMaker/ImageRPGMV.cs`, class `RpgmvpFormat`, over `RpgmvDecryptor` in the
same file. GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/rpg-maker/rpgmvp-image.ts` (`rpgMakerRpgmvpImageDescriptor`,
`rpgMakerRpgmvpImageFormat`, id `rpg-maker-rpgmvp-image`), over
`packages/formats/src/rpg-maker/rpgmv-core.ts`.

## The file

places at `0x04` naming which kind of file it is — `V` for the pictures and the sounds of the engine. The

every file of the engine of either kind stands behind the words of the engine and stands otherwise as it
stands.

## Where the key stands

places: two and three and four places above the file and beside it. The key stands in the words of the engine
reference keeps the same key for the file behind it, and this port asks for the key of every file it reads.

no file this project reads: the reference reads a key out of such a file rather than standing with a key of
its own, for the key the reference declares and never reads, `RpgmvDecryptor.DefaultKey`, stands in the
reference as a word this port does not read either.

## Deviations from the reference

  with the words of the kind of file systems that name them; this port asks the same places with the words of
  this kind of file system.
- A place of the key that stands as no place of a byte, and words of the engine of an odd number of places,
  key.
- Words of the engine that stand as no file of the engine, and a file of the engine whose places stand as no
  picture, are turned away; the reference would throw while reading them.
  for this project reads the head of such a file and not its places.

## Tests

and the words that do not, where the key stands beside the file and above it and where it stands nowhere, the
whose key stands nowhere, a file of the engine whose places stand for no picture, and the words of the engine
the file is told by.
