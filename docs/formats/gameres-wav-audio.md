# Wave audio format

Reference: `GARbro/GameRes/AudioWAV.cs`, classes `WaveAudio` and `WaveInput`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/gameres/wav-audio.ts` (`gameresWavAudioDescriptor`,
`gameresWavAudioFormat`, id `gameres-wav-audio`, `isWavHead`, `readWavLayout`, `findWavChunk`,
`findWavDataChunk`, `readWavEmbedded`). The places of a sound of the MPEG Layer 3 kind are told apart with
`looksLikeMp3` of `packages/formats/src/gameres/mp3-audio.ts`.

The reference registers the word `RIFF` and the name `wav`.

## The head

The word `RIFF` stands at the beginning of the file with the word `WAVE` at `0x08`, and the word of the codec
the places of the sound stand as stands at `0x14`, where it stands because the chunk that names how the places
of a sound stand is the first chunk behind the head. A file whose places stand as a sound of their own — the
words `0xFFFF`, `0x674F`, `0x676F` and `0x6770` — is not claimed, which is what the reference does before it
stands its own sound reader over the file.

## The walk of the chunks

The chunks of a wave stand one behind the other behind the head, every chunk naming its own length in the four
places behind its word, and a chunk whose length is odd stands a place behind it that the length does not
count. The width of the sound, how fast it runs, how many places of a colour stand in a step of it and how
many places of a colour stand in a place of it all stand in the chunk that names how the places of the sound
stand; the places of the sound themselves stand in the chunk named `data`. The walk of the reference's own
sound reader takes the last chunk of a file as it stands where it names more places than the file holds, and so
does this port.

## The places of a sound that stand as a sound of their own

Where the word of the codec names a sound whose places stand as a sound of their own — the words `0x674F`,
`0x6751` and `0x6771` of the Ogg kind and the word `0x0055` of the MPEG Layer 3 kind — the reference offers
those places to every kind of sound it knows and hands out the one that claims them. This port names the two
kinds it knows of its own: a sound that begins with the word `OggS` is handed out as a sound of the Ogg kind,
and the places of an MPEG Layer 3 sound are told apart the way its own port tells them apart. A wave of those
codecs whose places are neither is handed out as the wave it stands in.

## Deviations from the reference

- The width of a wave stands in the chunk that names how the places of its sound stand rather than at a place
  of its own, so a wave whose chunks stand in another order than the reference's own reader takes them still
  hands out the right width; the word of the codec is read where the reference reads it, at `0x14`.
- A file of fewer than twenty two bytes, a file that does not hold the words of the format, a wave whose word
  of a codec stands in the words the reference turns away from this kind, a file whose places of a sound stand
  before a whole chunk that names how they stand, a wave of no places of a colour, and a wave whose chunk that
  names how its places stand does not stand whole in the file are refused with a message, where the reference
  would throw inside the sound reader of the platform it stands on.
- The places of a sound stand as they stand in the file rather than being turned into places of a sound of the
  plain kind, so a wave whose places stand as a sound of the kinds that need turning — the places of a sound of
  the kinds the words `2`, `7` and `0x11` name — hands out those places as they stand.

## Tests

`tests/formats/gameres-wav-audio.test.ts` covers the head and the words it is turned away for, a wave of no
places of a colour, the walk of the chunks with a chunk of no sound and a chunk of an odd length before the
chunk the places of the sound stand in, the places of a sound that stand as a sound of the Ogg kind, the places
of a sound that stand as the places of an MPEG Layer 3 sound, a wave of those codecs whose places are neither,
the wave handed out as it stands, the sound handed out where it stands as a sound of its own, and the finding
of a wave of its own kind.
