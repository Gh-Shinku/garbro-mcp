# Studio B-Room EZS audio

Reference: `GARbro/Legacy/BRoom/AudioEZS.cs`, class `EzsAudio`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/broom/ezs-audio.ts` (`ezsAudioDescriptor`, `ezsAudioFormat`, id
`broom-ezs-audio`).

Raw PCM behind a header whose **wave fields are chained back to their real values**. The reference takes a key
from the low byte of the field at offset `0x15`, then walks the fields in a fixed order, each step exclusive
oring its stored value with a value the *previous step produced*:

```
key            = cbSize & 0xFF
cbSize         = cbSize ^ key            // only the high byte survives
bits           = storedBits ^ key
averageBytes   = storedAverageBytes ^ cbSize
blockAlign     = storedBlockAlign ^ (averageBytes & 0xFFFF)
channels       = storedChannels ^ blockAlign
sampleRate     = storedSampleRate ^ channels
formatTag      = storedFormatTag ^ bits
```

Two details of the reference are worth recording, and both are documented in the port:

* the byte at offset four is read into the key variable and then **immediately overwritten** by the low byte of
  the `cbSize` field, so it is never used. The port therefore does not read it at all, and a test proves the
  byte has no effect by opening two files that differ only in that position and comparing the outputs;
* the `DefaultKey = 0xDD` constant the class declares is **commented out** of the assignment that would have
  used it — the line that would apply it is disabled in the source, so the constant is dead code. The port does
  not carry it.

The reference checks the decoded bit depth (8 or 16) and the decoded channel count (1 or 2) as it goes, and
returns null when either is out of range; the port does the same, and a test provokes each rejection by storing
the inverse of an out of range value. The declared payload size at offset zero is only compared with the file
length and never used as a bound, so the payload really is everything from offset `0x1B` to the end — a test
covers a header only file, which lists with a `pcmSize` of zero.

The port exposes the resource as a single entry:

* extraction writes a **canonical** wave file through the shared `writeWave` helper, the shape used by the WAZ,
  WRG, VZY and PMW audio ports, so `sizeKnown` is false;
* the entry is named after the source file with a `wav` extension and covers the whole stored file;
* entry and archive metadata carry `type: "audio"`, `format: "wav"`, the decoded format tag, channel count,
  sample rate and bit depth, and the `pcmSize`;
* the reference declares no signature and gates on the `.EZS` extension, so the descriptor registers neither a
  signature nor an extension and the extension check lives in detection, matching the other extension gated
  ports.

GARbro's `CanWrite` is false, so encoding is out of scope.

## Verifying a chain like this

The test fixture has to store the **inverse image** of every field, so it cannot simply repeat the numbers the
port is expected to produce. The stored values were worked out by hand from the C# and written down with their
arithmetic in comments; the first attempt got the average bytes per second wrong (`88200` is `0x15888`, not
`0x158C8`) and detection failed on four tests. The test also asserts that each stored field differs from the
value it decodes to, so a port that silently skipped the chain could not pass by reading its own output back.
