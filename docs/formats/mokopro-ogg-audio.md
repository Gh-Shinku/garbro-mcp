# Mokopro compressed audio

Reference: `GARbro/ArcFormats/MokoPro/CompressedFile.cs`, classes `NNNNOggAudio` and `MokoCrypt`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/moko-pro/ogg-audio.ts` (`mokoProOggAudioDescriptor`,
`mokoProOggAudioFormat`, id `mokopro-ogg-audio`), with the container of the engine in
`packages/formats/src/moko-pro/moko-core.ts` (`MOKO_SIGNATURE`, `decryptMoko`, `readMokoHeader`,
`unpackMoko`).

The reference registers the word `NNNN` and no name; the archive shape of the same container
(`mokopro-nnnn`) registers the very word, so the sound and the picture are tried ahead of the archive wherever
no name says otherwise.

## The container

The file begins with the word `NNNN` and the size of what stands behind it, and everything behind those eight
bytes is walked over backwards — every byte mixed with the byte behind it and two bytes of key — and then
walked out by a walk of runs whose ring is filled with spaces instead of noughts. What that gives is a sound
of the Ogg kind, and the word `OggS` stands at its beginning.

## Deviations from the reference

- The reference hands the sound to its own decoder of the Ogg kind; the port hands out the sound of the Ogg
  kind as it stands, since this project holds no decoder for it.
- A file of fewer than eight bytes, a file whose word is not `NNNN`, a file whose size of the walk of runs
  stands below one or above what this project will hold, and a walk of runs whose sound does not begin with
  the word `OggS` are turned away; the reference would throw while reading the head of the container or
  wherever its own decoder refused the sound.

## Tests

`tests/formats/mokopro-ogg-audio.test.ts` covers the unwrapping of a sound behind the walk of runs — with its
name, its sizes and the sound itself — a payload that does not begin with the word of the Ogg kind and a file
whose word is not `NNNN`.
