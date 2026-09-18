# CrossNet ADPCM-compressed audio

Reference: `GARbro/Legacy/CrossNet/AudioADP.cs`, classes `AdpAudio` and `AdpDecoder`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/crossnet/adp-audio.ts` (`crossNetAdpAudioDescriptor`,
`crossNetAdpAudioFormat`, id `crossnet-adp-audio`, `readCrossNetAdpLayout`, `decodeCrossNetAdp`,
`CrossNetAdpDecoder`).

The reference registers the mark `RIFF` and, in its `TryOpen`, asks for two more things: the name has to end
in `.adp` — which is what tells a wave of this codec from every other wave — and the head has to carry the
mark `WAVEfmt ` at eight, a format size at `0x10`, the codec `0xFFFF` (which no standard wave uses) at
`0x14`, one or two channels at `0x16` and the sample rate at `0x18`.

The sections then begin at `0x14` plus the format size. Each carries its own name and size, padded to an even
length; the walk follows them until `data`, whose size sets the count the samples are walked by, and takes
the step of the walk from a `shft` section on the way. A missing `shft` section leaves the step at two, and a
negative one is a step of two as well.

A sound of one channel has the **lower** nibble of a byte decoded first and the higher behind it, both by the
same walk; a sound of two channels gives a whole byte to each walk in turn, so the two samples of a frame
stand in the order left, right. The samples are handed out as a sixteen bit wave.

One step of the engine's own ADPCM takes the quantiser before it moves, scales it by the code's own entry of
the scale table and shifts it by the section's step, keeps the sample within a signed word and the quantiser
within the table's bounds.

Deviations from the reference, in the message only: a file too short to hold the stream the head declares is
refused rather than failing part way through, and the extension is checked while detecting, which is where
this project keeps the gating the reference's own `TryOpen` does. The reference's write path throws
`NotImplementedException`, so this is a read only format.

The tests cover the head and the sections, the fields it is turned away for, the extension it asks for, one
step of the decoder with its nibble order, the wave of a sound of one channel, the two walks of a sound of
two channels, the step of a `shft` section, and a file that does not hold a sound.
