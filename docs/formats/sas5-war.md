# SAS5 engine audio archive

Reference: `GARbro/ArcFormats/Sas5/ArcWAR.cs`, classes `WarOpener` and `War2Opener`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/sas5/war.ts` (`sas5WarDescriptor`, `sas5War2Descriptor`, `sas5WarFormat`,
`sas5War2Format`, ids `sas5-war` and `sas5-war2`, `readWarIndex`, `warEntryName`, `openWarWave`).

The reference names two kinds of archive of this engine, the first standing behind the words `war ` and the
second behind the words `war2`; the words of the head behind those stand the same way for both.

## The index

The head names how many places the index stands in, how many places every one of them stands in — which stands
at `0x18` places or more — and the index itself stands at `0x10`. Every place of the index names where the
places of a file of the archive stand, how much of it stands, and the kind of the sound it stands for: the
places of a sound of the first kind stand as the places of a wave, a sound of the second kind stands as a sound
of the Ogg kind, and a file of any other kind stands as it stands.

## The places of a sound of the first kind

The places of such a file stand behind the words that name how the places of the wave stand and how much of it
stands, and behind those stand the places that name how the places of the wave stand. The reference writes the
words of a wave around those places as they stand rather than reading them, one place of the wave standing as
it stands among the places of a file of this kind.

## Deviations from the reference

- The reference names a file of an archive by the places of the engine's own tables and falls back on the name
  of the archive and the place of the file in the index where no such places stand; this port reads the names
  of those tables as no names at all and names every file of an archive by the name of the archive and its
  place in the index.
- The reference reads the places of a sound of the first kind as the places of a wave without reading how far
  they reach; this port turns a sound whose places stand outside the file away.
- A head that names no places of an index, an index whose places stand outside the file, and a place of a file
  that stands outside the archive are turned away; the reference would throw while reading them.

## Tests

`tests/formats/sas5-war.test.ts` covers the index of an archive, the heads it is turned away for, the names of
the files of an archive, the words of a wave written around the places of a sound of the first kind, the files
of an archive handed out, an archive of the second kind, and a file whose places stand as no sound at all.
