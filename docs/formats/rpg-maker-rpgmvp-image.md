# RPG Maker engine image format

Reference: `GARbro/Experimental/RPGMaker/ImageRPGMV.cs`, class `RpgmvpFormat`, over `RpgmvDecryptor` in the
same file. GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/rpg-maker/rpgmvp-image.ts` (`rpgMakerRpgmvpImageDescriptor`,
`rpgMakerRpgmvpImageFormat`, id `rpg-maker-rpgmvp-image`), over
`packages/formats/src/rpg-maker/rpgmv-core.ts`.

## The file

A picture of this kind stands behind the words `RPGMV` in the first five places of it, a word standing in the
places at `0x04` naming which kind of file it is — `V` for the pictures and the sounds of the engine. The
places of the key stand in the sixteen places behind the head of the file, and every one of them stands beside
the places of the key; the places behind those stand as the file the key stands for.

The reference reads the places of the key beside the head to tell whether the words of the kind of file stand
behind them — the places of a portable network graphic for a picture — and hands out what stands behind the
head: the first sixteen places stood beside the places of the key, and the rest of the file as it stands, for
every file of the engine of either kind stands behind the words of the engine and stands otherwise as it
stands.

## Where the key stands

`RpgmvDecryptor.FindKeyFor` looks for a file of the places of the engine naming the key, `System.json`, in six
places: two and three and four places above the file and beside it. The key stands in the words of the engine
under the name `encryptionKey`, as the places of the key written one place of a byte in two places. The
reference keeps the same key for the file behind it, and this port asks for the key of every file it reads.

A file of the engine that stands with no file of the places of the engine beside it, and above it, stands as
no file this project reads: the reference reads a key out of such a file rather than standing with a key of
its own, for the key the reference declares and never reads, `RpgmvDecryptor.DefaultKey`, stands in the
reference as a word this port does not read either.

## Deviations from the reference

- The reference asks the places of the file system of the kind it stands on, which name the places of a file
  with the words of the kind of file systems that name them; this port asks the same places with the words of
  this kind of file system.
- A place of the key that stands as no place of a byte, and words of the engine of an odd number of places,
  name no key; the reference reads the places of any such word and stands the words it reads as places of a
  key.
- Words of the engine that stand as no file of the engine, and a file of the engine whose places stand as no
  picture, are turned away; the reference would throw while reading them.
- The places of the picture stand as the words of a portable network graphic and are handed out as they stand,
  for this project reads the head of such a file and not its places.

## Tests

`tests/formats/rpg-maker-rpgmv.test.ts` covers the places of the key, the words of the engine that name them
and the words that do not, where the key stands beside the file and above it and where it stands nowhere, the
places of the key stood beside the head of the file, the picture a file of this kind stands for, the file
whose key stands nowhere, a file of the engine whose places stand for no picture, and the words of the engine
the file is told by.
