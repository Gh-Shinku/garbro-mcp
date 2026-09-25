# CVNS engine compressed audio

Reference: `ArcFormats/Cmvs/AudioMV2.cs`, classes `Mv2Audio` and `Mv2Decoder`, which stand on the
`MvDecoderBase` of `ArcFormats/Cmvs/AudioMV.cs` (the first filter's coefficients are that file's
`MvDecoder.Coef1Table`). GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`. Implemented as
`cmvs-mv2-audio` (`packages/formats/src/cmvs/mv2-audio.ts`), with the bit reader and the head shared in
`cmvs/mv-common.ts` and the five tables in `cmvs/mv-tables.ts` for the older sound of the same engine.

## The head and the bits

A sound of this engine opens with the word `MV2X`, and its head is eighteen bytes long: the size of one
channel at 4, the rate at 0xA, the number of channels at 0xC, the shift at 0xD and the number of runs at
0xE. A channel holds sixteen bit samples, so a frame is `channels * 2` bytes and the sound is
`blockAlign * channelSize` bytes of samples.

The coefficients and the runs are read by a bit reader of the engine's own: a word is read as four bytes
least significant first and consumed **from its lowest bit up**, and the bits a read gathers are built most
significant first, so the first bit read becomes the top of the value. A run of coefficients is written as
a count of one bits ended by a nothing. GARbro's own view reads a word past the end of a sound as the bytes
that stand there and nothing behind them; this port does the same through `Buffer` bounds and marks the
reader exhausted, so a truncated sound stops the walk instead of failing.

## The walk

Every run names, in ten and nine bits, how many coefficients stand behind it and which of the table's own
scales belongs to them. A coefficient is written as a run of bits (its width) and then its value, read as a
signed number of that width; a run of no width stands for as many coefficients as the three bits behind it
name, stepped over. Each coefficient is the scale of the run times its own value.

The samples are then gathered in two passes for every channel, ten rounds of each: the first gathers sixty
four samples from the run's coefficients through the reference's `Coef1Table`, and the second reads thirty
two of those through `Coef2Table`, taking its coefficients four at a time and **subtracting** every other
one. Between the two passes the place the first gather wrote at steps back by sixty four and wraps inside a
kiloword ring. Every sample is then taken down by `6 - shift` and clamped to a sixteen bit value, which is
the reference's own `Clamp (pre_sample3[j] >> shift)` - the shift first and the clamp behind it.

## Deviations from the reference

* The reference writes the first gather at `pre2_index + channel * 0x400 + j` **without** keeping it inside
  its ring, which walks off the end of its own place for anything but a sound of one channel; this port
  masks the place into the ring, so a sound of any channel count decodes.
* A sound whose coefficients run past the end of the file stops the walk and is handed over as far as it was
  written; the reference reads its own view past the end, which gives zeroes.
* The reference marks the flat output of the *older* sound with a `???`; the interleaved output of this one
  is what the writer here uses, one channel after the other inside a frame.

## Verification

Seven tests over synthetic fixtures (`tests/formats/cmvs-mv2-audio.test.ts`): the head and its refusals, the
bit reader of the engine (its bit order, its runs of one bits, its behaviour at the end of a sound), a sound
whose runs name no coefficient at all and so comes out as nothing, a run that names thirty two coefficients
and whose samples are therefore not nothing, and a whole sound handed over as a wave. The filter chain is
pinned against a plain **mirror** of the reference written out again in the test file, which is what caught
one real slip of the port: the shift and the clamp stand in the other order. That mirror stands on the same
source as the port, so it pins a transcription rather than the algorithm's fidelity to a real file; that
fidelity is what the remaining verification below asks for.
