# AZSYSTEM/1.0 audio format

Reference: `GARbro/ArcFormats/Cadath/AudioVWF.cs`, class `VwfAudio`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/cadath/vwf-audio.ts` (`cadathVwfAudioDescriptor`,
`cadathVwfAudioFormat`, id `cadath-vwf-audio`, `readVwfLayout`, `decodeVwfAdp`).

The file begins with the word `VWF` and a nought of its own — the word the reference registers — the size of
the unwrapped sound stands at five, the sample rate at `0x0D`, the sample the walk begins from at `0x11`, and
the sizes of two streams at `0x13` and `0x17`. Every one of the two stands four bytes of its own behind its
place, the unwrapped length as a word, and then a zlib stream.

Only the first stream is scrambled: it is *the whole of it* that `Cadath image`'s `Decrypt` runs over, which
is why the two formats of this engine share that walk. The second stream is only wrapped. When both are
unwrapped, the first holds one bit a sample — a single place of it turns the sample over — and the second
holds two nibbles a byte that step the sample up and down:

* how far the quantiser moves comes from the Cadath table (`-1, -1, -1, 0, 2, 4, 6, 8, -1, -1, -1, 0, 2, 4,
  6, 8`), which is the Abogado table but for the fourth and twelfth steps, and the quantiser is held between
  nought and `0x58`;
* the step of a code is a quarter of the quantiser plus, for the three lower places of the code, the whole of
  the quantiser, its half and its quarter;
* a code below eight climbs and a code of eight and above falls.

What is written out is a wave file of one channel of sixteen bit samples at the rate the head gives.

Deviations from the reference: a file whose unwrapped size, stream sizes or sample rate are nought, negative
or past what the file holds is turned away where the reference would read past its own end or hand a wave
header of an impossible size to its caller. The reference clamps every sample to nought before its place is
read, so the falling half of the walk is unreachable — the port keeps that behaviour rather than the
algorithm the walk was clearly meant to be.

The tests cover the head, the marks and the sizes it is turned away for, three steps of the nibble walk, the
unwrapping of both streams into a wave of the samples and the turning over of the first of them, and a file
that does not hold a sound.
