# RPG Maker engine audio format

Reference: `GARbro/Experimental/RPGMaker/AudioRPGMV.cs`, class `RpgmvoAudio`, over `RpgmvDecryptor` in
`Experimental/RPGMaker/ImageRPGMV.cs`. GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/rpg-maker/rpgmvo-audio.ts` (`rpgMakerRpgmvoAudioDescriptor`,
`rpgMakerRpgmvoAudioFormat`, id `rpg-maker-rpgmvo-audio`), over
`packages/formats/src/rpg-maker/rpgmv-core.ts`.

## The file

A sound of this kind stands behind the words `RPGMV`, the word at `0x04` naming the kind of file as the
pictures of the engine name it, and the places of the key standing in the sixteen places behind the head of
the file. The places of the key stood beside the head stand as the words of a sound of the Ogg kind, which is
what tells a sound of this kind from a picture of the same engine.

What the key stands for, where the key stands, and what the reference does where no key stands at all are the
same as for the pictures of the engine, which `docs/formats/rpg-maker-rpgmvp-image.md` names.

## Deviations from the reference

- The reference hands the places behind the head to a reader of sounds of the Ogg kind and this project reads
  no places of a sound at all, so the places of the sound stand behind the words of a sound of the Ogg kind
  and are handed out as they stand.
- The names the reference follows to stand beside a key, the places of a key that stand as no place of a byte,
  and the files of the engine whose places stand as no sound are turned away as they stand turned away for the
  pictures of the engine.

## Tests

`tests/formats/rpg-maker-rpgmv.test.ts` covers the places of the key, where the key stands beside the file and
above it, the places of the key stood beside the head of the file, the sound a file of this kind stands for, a
file whose places stand as a picture rather than a sound, a file of the engine whose key stands nowhere, and
the words of the engine the file is told by.
