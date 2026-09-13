# Tmr-Hiro wave audio

Reference: `GARbro/ArcFormats/Tmr-Hiro/AudioTmr.cs`, class `TmrHiroAudio`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/tmr-hiro/wav-audio.ts` (`tmrHiroAudioDescriptor`,
`tmrHiroAudioFormat`, id `tmr-hiro-wav-audio`).

**Raw PCM with a nine byte header and a single hard coded format.** The reference declares no signature
and registers the empty extension, i.e. extension-less file names; what actually identifies the format is
a pair of byte checks plus an exact length relation:

| check | offset |
|---|---|
| `0x44` | 0 |
| zero | 4 |
| payload length (`i32`) | 5, must equal the file length minus 9 |
| PCM data | 9 |

The format is not read from the file at all: format tag 1, two channels, 44100 Hz, 16 bits, block align
4 and `44100 * 4` average bytes per second are hard coded in the reference, which the port reproduces from
the same constants.

The port exposes the resource as a single entry:

* detection is the two byte checks and the length relation, since there is no signature to match on. The
  three free bytes at offsets 1..3 are never inspected, exactly as in the reference;
* the entry is named after the source file with a `wav` extension, covers exactly the declared payload
  and sets `sizeKnown: false` because a RIFF header is prepended;
* extraction writes a 44 byte RIFF/WAVE header holding the hard coded format followed by the PCM bytes.
  A header whose declared length is zero is accepted and yields an empty data chunk, which is what the
  reference does;
* entry metadata carries `type: "audio"`, and the archive metadata records `audio: "pcm"` with the
  channel count, sample rate and bit depth.

Encoding and archive creation are out of scope.
