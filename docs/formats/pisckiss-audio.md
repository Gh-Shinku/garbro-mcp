# Pisckiss encrypted audio

Reference: `GARbro/Legacy/Pisckiss/Audio0.cs`, class `Audio1`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).
The class name and the file name disagree in the reference itself: the file is `Audio0.cs` and it declares
`Audio1`. The implementation here is `packages/formats/src/pisckiss/audio.ts` (id `pisckiss-audio`).

## The first byte is a seed and a tag at once

`signature & 0x42` is read as a **three way switch**, not a mask test:

| first byte | payload |
|---|---|
| both 0x40 and 0x02 set | the file less its first byte and its last two |
| exactly one of them set | the file less its first byte and its last one |
| neither set | not a Pisckiss file at all |

So a file whose first byte has neither bit is rejected outright, and the two variants differ only in how many
trailing bytes are discarded. The bytes from offset one up to `length - trimmed` are the payload, where
`trimmed` is three for the both-bits case and one otherwise.

Every *other* bit of that byte seeds the key:

```
key = (first & 0xBD) ^ 0x6A8CD4E7
```

`0xBD` is the complement of the tag mask, so the tag bits are excluded from the key — a first byte of 0x40 and
one of 0x02 produce **exactly the same keystream**. A test asserts that, because it is the sort of thing that
looks like a mistake until you check the mask.

## The register

One step per byte, and only the low eight bits of the state are used:

```
data[i] ^= key & 0xFF
key = key << 1 | ((key & 0x10000) ^ (key >> 15)) >> 16
```

The new bit is therefore **bit 31 exclusive or bit 16** of the register. Both shifts read the state as
unsigned, so the port uses `>>>` where the source uses a `uint` — a signed shift would drag bit 31 down through
the whole word.

With a tag byte of 0x40 the key starts at the bare seed, and the first two key bytes are hand computable:
`0x6A8CD4E7` gives 0xE7, and after one step — bit 31 and bit 16 are both one, so the new bit is zero — the state
is `0xD519A9CE` and the second byte is 0xCE. A test pins exactly that pair, and the fixture's own ciphertext
bytes against it.

## What the payload is

The four decrypted bytes after the first are the marker, and only two are accepted:

* `RIFF` — handed to the wave reader, whose samples are re-serialised into a canonical wave, exactly as the
  reference's `WaveInput` does;
* `OggS` — carried over as it is, since there is no Ogg decoder here.

Anything else means this is not the format, which is a *decline* rather than a failure to extract: the reference
returns null from its probe. A payload that claims `RIFF` but carries no chunks does fail, at extraction, where
the reference's wave reader would throw.

The extraction drops the leading byte and the trailing ones, so `sizeKnown` is false. `CanWrite` is false in the
reference as well.

## Process notes

Two fixture faults, both mine, both worth recording:

* the fixture's default first byte was 0x00 — which the gate above **rejects** — so three tests built files that
  the port was right to decline. The test asserting which bytes are declined and the tests building files had
  been written from different assumptions;
* the wave assertions used offsets for a layout without the four byte chunk size, so the data chunk was looked
  for at 28 instead of 36. Counting the bytes of a canonical header, not assuming them, is the fix.
