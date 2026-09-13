# Uncanny encrypted WAV audio

Reference: `GARbro/Legacy/Uncanny/AudioCWV.cs`, class `CwvAudio`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/uncanny/cwv-audio.ts` (`cwvAudioDescriptor`, `cwvAudioFormat`,
id `uncanny-cwv-audio`).

A **WAV file encrypted with a keystream cipher**, whole-file and length preserving. The registry
signature is `0xA06F8BF7`, which is not an arbitrary constant: it is the cipher's output for the four
bytes `RIFF`, so a real file's first word decrypts back to the RIFF tag. The test proves this by
implementing the cipher independently and asserting that `RIFF` maps to exactly those four bytes —
a cross check against the reference's own declared signature.

The cipher (`CwvAudio.Decrypt`) starts from the key `0x4B5AB4A5` and, per byte:

```text
x     = (key & 0xFF) ^ stored
key   = ((key << 9) | ((key >>> 23) & 0x1F0)) ^ x
```

Both shifts are wrapped to unsigned, which the reference gets for free from `uint` arithmetic; the
rotation is the quirky part — `& 0x1F0` keeps bits 4..8 of the nine shifted-out bits, not all nine. The
update absorbs the **recovered** byte, which is what makes this the exact inverse of the original
encryptor (that one absorbs the plaintext it is given).

The port exposes the resource as a single entry:

* detection decrypts the first `0x10` bytes and requires `WAVEfmt ` at offset 8, exactly as the reference
  does, plus a `RIFF` check at offset 0 that stands in for the chunk walk the reference delegates to
  `Wav.TryOpen`. No further WAV validation is performed, which is documented;
* extraction decrypts the **whole file**, so the output is byte-for-byte the original WAV at the same
  length. Since the cipher is length preserving, this is the first port that marks its entry
  `sizeKnown: true` rather than false: the listed size really is the extracted size;
* the entry is named after the source file with a `wav` extension, covers the whole stored file and is
  flagged `encrypted: true`;
* entry metadata carries `type: "audio"`, and the archive metadata records `audio: "wav"` and
  `encrypted: true`.

Encoding and archive creation are out of scope.
