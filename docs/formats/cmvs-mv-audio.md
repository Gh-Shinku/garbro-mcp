# PVNS engine compressed audio

Reference: `ArcFormats/Cmvs/AudioMV.cs`, classes `MvAudio` and `MvDecoder`, on the file's own `MvDecoderBase`
(whose `MvDecoder.Coef1Table` the newer sound of the same engine shares). GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`. Implemented as `cmvs-mv-audio`
(`packages/formats/src/cmvs/mv-audio.ts`), with the bit reader and the head shared in `cmvs/mv-common.ts`
and the tables in `cmvs/mv-tables.ts`.

## The head and the bits

The sound opens with the word `MKVS`, and its head is the same eighteen bytes as the newer sound's: the size
of one channel at 4, the rate at 0xA, the number of channels at 0xC, a byte at 0xD this sound does not read,
and the number of runs at 0xE. A frame is `channels * 2` bytes and the sound unfolds to
`blockAlign * channelSize` bytes. The bits are read the same way as the newer sound's - a word of four bytes
least significant first, consumed from its lowest bit up, gathered most significant first - and GARbro's own
view reads a word past the end of a sound as the bytes that stand there and nothing behind them, which this
port does through `Buffer` bounds while marking the reader exhausted.

## The walk

Every run names, in ten bits each, how many coefficients stand behind it and which of the table's scales
belongs to them. A coefficient is a width written as a run of one bits ended by a nothing, then its value,
read as a signed number of that width; a run of no width stands for as many coefficients as the three bits
behind it name, stepped over. Every coefficient is the run's scale times its own value.

The samples are gathered in ten rounds of two filters for every channel. The first gathers sixty four of
them from the run's coefficients through `Coef1Table`; the second reads thirty two of those through
`Coef2Table`, taking **sixteen** coefficients per sample **one after another** from the start of the table
and adding the first four, subtracting the next four, and so on. Each sample is then taken down by a
constant one and clamped, written flat - channel after channel rather than interleaved.

## What stands apart from the newer sound of the same engine

Reading the two decoders side by side is worth it, because the three differences are easy to miss:

* The newer sound clears only the **first row** of the place its coefficients are gathered in, while this one
  clears the whole of it. The first filter reads past that row, so the tail matters.
* The newer sound's second filter takes its coefficients at strides of thirty two from a place that depends
  on the sample it is gathering, and it shifts its samples down by `6 - shift` from the head. This one counts
  straight through its table from beginning to end, sixteen coefficients to a sample, and shifts by a
  constant one.
* The newer sound interleaves its channels inside a frame; this one writes them one after the other, which
  the reference itself marks with a `??? shouldn't channel interleaving be taken into account?`.

## Deviations from the reference

* The reference writes its first filter's gather at `pre2_index + j` **without** keeping it inside its own
  place, which walks off the end of it; this port masks the place.
* The flat write leaves a sound of more than one channel longer than the buffer the head names; this port
  stops at the end of that buffer where the reference would write past it.
* A sound whose coefficients run past the end of the file stops the walk and is handed over as far as it was
  written, where the reference reads its own padded view.

## Verification

Six tests over synthetic fixtures (`tests/formats/cmvs-mv-audio.test.ts`): the shapes of the three tables of
this sound (the scale table is the file's own short list placed at 0x192 of a kiloword table), the head with
its refusals and the word that stands before it, the bit reader, a sound whose runs name no coefficient and
so comes out as nothing, a run naming thirty two coefficients whose samples are therefore not nothing, and a
whole sound handed over as a wave. The filter chain is pinned against a plain **mirror** of the reference
written out again in the test file. That mirror caught a real slip of the port - the second filter's
coefficient counter runs on across the samples of a round rather than being reset for each of them - and the
mirror itself was wrong about the place it steps through, which the same comparison also showed. Because the
mirror stands on the same source as the port, it pins a transcription rather than the algorithm's fidelity to
a real file; that fidelity is what the remaining verification asks for.
