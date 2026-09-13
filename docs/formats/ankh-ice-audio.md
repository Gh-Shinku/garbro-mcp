# Ankh / Ice Soft PCM audio

Reference: `GARbro/ArcFormats/Ankh/AudioPCM.cs`, class `IceAudio` (namespace `GameRes.Formats.Ice`)
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/ankh/ice-audio.ts` (`iceAudioDescriptor`, `iceAudioFormat`, id
`ankh-ice-audio`). The format was on this project's deferred list out of caution; reading it shows it needs no
codec at all — it is a header and a copy.

| field | offset |
|---|---|
| format tag (`u16`) | 0 |
| channels (`u16`) | 2 |
| sample rate (`u32`) | 4 |
| average bytes a second (`u32`) | 8 |
| block alignment (`u16`) | 0xC |
| bits a sample (`u16`) | 0xE |
| extra size (`u16`, must be zero) | 0x10 |
| pcm size (`u32`) | 0x12 |
| pcm | 0x16 |

There are no RIFF markers anywhere: the file holds a wave's `fmt ` payload, the extra size word a `fmt ` chunk
may carry, and the data size — twenty two bytes in all — and then the raw samples.

## The two signatures are the channel count

The reference registers `0x010001` and `0x020001`, which as three byte prefixes are `01 00 01` and `01 00 02`.
Those are not two versions of anything: the first two bytes are the format tag, which is one, and the third is
the **low byte of the channel count**, which the very next field carries. So the pair is how the dispatcher
says "PCM with one or two channels", and the reference's own `channels != 1 && channels != 2` check says the
same thing a step later.

My first version of the port called it a version byte and the test built an independent one — which the
fixture's own channel write overwrote, because they are the same byte. The port now re-checks the signature
bytes explicitly, as this project's rule requires, and the tests state the relation instead: mono carries
`01 00 01`, stereo carries `01 00 02`, and three channels moves the byte to three, which neither signature
names and the channel check rejects anyway.

## The byte rate check multiplies in thirty two bits

```csharp
if (0 == format.AverageBytesPerSecond
    || format.SamplesPerSecond * format.BlockAlign != format.AverageBytesPerSecond)
    return null;
```

`SamplesPerSecond` is a `uint`, so the product **wraps**: a file with a sample rate of 0x80000000 and a block
alignment of three multiplies to 0x180000000, which the reference sees as 0x80000000 and accepts when that is
the declared byte rate. The port multiplies with `>>> 0` for the same reason, and a test asserts both the wrap
and the acceptance — a wider multiply would reject a file the reference takes.

## Notes

* The announced pcm size has to account for the whole file, so a byte short, a byte long and a trailing byte
  are three separate declines; a test covers all three.
* A zero length payload is accepted, since the header alone satisfies the size check, and extracts as a
  forty four byte wave with no samples.
* `Extensions` is a single empty string in the reference, which is its way of saying "any"; the port declares no
  extension and relies on the signature.
* Extraction wraps the pcm in a canonical wave built from the format's own header — the reference hands out a
  raw PCM stream, and a wave container is what an extraction wants. The entry is therefore longer than the
  stored file, so `sizeKnown` is false.
* The format tag, the extra size word, the channel count, the byte rate relationship and the size are all
  checked; a header shorter than twenty two bytes is declined without throwing.
* `CanWrite` is not set, so encoding is out of scope.
