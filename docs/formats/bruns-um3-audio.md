# Bruns UM3 audio

Reference: `GARbro/ArcFormats/Bruns/AudioUM3.cs`, classes `Um3Audio` and `Um3Stream`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/bruns/um3-audio.ts` (`um3AudioDescriptor`, `um3AudioFormat`, id
`bruns-um3-audio`).

An **Ogg stream whose first `0x800` bytes are inverted**. The signature `0xAC9898B0` is `OggS` with every
byte exclusive-ored with `0xFF`, which is exactly what the scramble does to the stream's own header — the
test asserts that relation rather than trusting the constant, so the two cannot drift apart.

The port exposes the resource as a single entry:

* the reference wraps the file in a stream that inverts every byte read up to offset `0x800` and passes
  everything after it through untouched. The port applies the same transformation to the stored buffer,
  and a test asserts both halves of that behaviour: the whole output equals the original Ogg stream, and
  the bytes beyond the scrambled region are byte-for-byte what was stored;
* detection matches the inverted signature and then re-checks the descrambled header against the real
  `OggS` magic. Because inverting is its own inverse, a file already carrying a plain `OggS` signature is
  declined, and a file shorter than the scrambled region is handled by scrambling whatever is present. Both
  are tested;
* inverting bytes preserves length, so the entry lists the stored size and sets `sizeKnown: true` — the
  sixth port here to make that claim. The output is otherwise a straight copy, not a rebuilt container;
* the entry is named after the source file with an `ogg` extension and is flagged `encrypted`, as is the
  archive metadata, which also records how many bytes were scrambled;
* entry metadata carries `type: "audio"`.

The reference class declares no extension list, so the descriptor registers none.

Encoding and archive creation are out of scope.
