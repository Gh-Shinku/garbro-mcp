# UMeSoft ike audio

Reference: `GARbro/Legacy/UMeSoft/AudioIKE.cs`, class `IkeAudio`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/ume-soft/ike-audio.ts` (`ikeAudioDescriptor`, `ikeAudioFormat`, id
`ume-soft-ike-audio`). The codec is not new: `packages/formats/src/ume-soft/ike.ts` already carried
`unpackIke` and `decodeIkeSize` for the UMeSoft BIN and Penguin PAC ports, so this format is a header and a
wave parser around a decoder that was already verified.

| field | offset |
|---|---|
| signature `9D 89 69 6B` | 0 |
| marker `ike` | 2 |
| unpacked size, three bytes | 10 |
| the codec's stream starts here | 0x0D |
| the first decoded literal, `RIFF` | 0x0F |

## The two offsets are adjacent, not far apart

`TryOpen` reads nineteen bytes and requires `ike` at offset two and `RIFF` at offset fifteen, then hands the
stream to `IkeReader.CreateStream`, which seeks to **0x0D**. Those look contradictory at first: if the codec
starts at 0x0D, how can bytes at 0x0F be a wave header rather than compressed data?

Because they are the same bytes. The Ike bit stream begins with a **sixteen bit word of flag bits** before any
literal byte, so the codec's own start at 0x0D is followed by two flag bytes, and the first literal — the `R` of
the wave header being decompressed — lands at exactly **0x0F**. The reference's check is therefore the
statement that the first literal of the stream is a wave header, and a test asserts the relation directly:
the two bytes between the codec's start and the marker exist, and the marker reads `RIFF`.

This was nearly ported as a deviation. The first reading of the source suggested the marker check could not be
satisfied by any file, which would have meant dropping a check the reference performs. Working out where the
flag word sits resolved it, and the check is implemented exactly as written — a reminder that "the reference
looks inconsistent" deserves one more look at the codec's framing before it becomes a documented difference.

## The marker is nearly redundant

`AsciiEqual (2, "ike")` overlaps the signature: `0x6B69899D` little endian is `9D 89 69 6B`, so bytes two and
three already spell `ik`. Only the `e` at offset four is information the signature does not carry, and the port
checks all three anyway. A test flips that byte and expects a decline, and another flips a signature byte.

## The size field holds six significant bits

`DecodeSize (a, b, c) = b + ((c + (a >> 2 << 8)) << 8)` reads three bytes, and the first of them contributes
only six bits after the shift, so the largest size the field can name is 0x3FFFFF. Anything above that
**truncates** rather than being rejected: the port's own limit of 64 MiB is unreachable through this encoding,
and a size of 0x4000000 encodes as all zeros, which the format declines as a zero size. A test pins the
encoding at three points — the maximum, that overflow, and 0x4000001, which truncates to a size of **one** and
is accepted as a one byte wave. That last case is what my first version of the test got wrong: I asserted the
fixture would be declined, but the value truncates to one rather than to zero.

## Notes

* Extraction decompresses from 0x0D and re-emits the wave **canonically** rather than passing it through, so
  bytes a producer left after the data chunk are dropped; a test appends two and checks they are gone.
* `Wav.TryOpen` supplies the format's real verdict — without a readable wave behind the codec the reference
  returns null and the file is not this format at all. A listing cannot afford to decompress, so the port
  reports the same verdict at extraction time: a payload that passes the header markers but holds no wave lists
  successfully and fails when extracted. That timing difference is the one recorded deviation here.
* A stream shorter than the declared size throws, as does a truncated header.
* The reference declares no extensions and the port matches, relying on the signature.
* `CanWrite` is false in the reference, so encoding is out of scope.
