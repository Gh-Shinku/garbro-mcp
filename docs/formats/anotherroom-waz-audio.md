# AnotherRoom WAZ audio

Reference: `GARbro/Legacy/AnotherRoom/AudioWAZ.cs`, class `WazAudio`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/anotherroom/waz-audio.ts` (`wazAudioDescriptor`, `wazAudioFormat`,
id `anotherroom-waz-audio`).

A **wave file inside an LZSS stream**. The whole stored file is the compressed stream — GARbro wraps it
from offset zero with the default `LzssStream` settings, which are the ones the repository codec
implements.

The signature `0x464952FF` looks like an obfuscated `RIFF` marker and is exactly that, but it is worth
noting *why* it takes this form: the bytes are `FF 52 49 46`, where `FF` is the LZSS control byte for a
group of eight literal bytes and `52 49 46` is the start of that group, reading `RIF`. The signature is
therefore a consequence of the compression rather than a magic word chosen by the game, and it is the
reason a plain uncompressed wave file fails this format's detection.

The port exposes the resource as a single entry:

* detection matches the signature, decompresses the stream and then walks its chunks the way GARbro's
  `Wav.TryOpen` does: `RIFF` and `WAVE` markers, a `fmt ` chunk of at least sixteen bytes and a `data`
  chunk. Chunks are word aligned, and a `data` size reaching past the end of the stream is **shortened**
  rather than rejected, because that is how a region behaves in the reference. A stream that does not
  decompress to a wave file, one without a `fmt ` chunk and a plain uncompressed wave file are all
  declined, each tested. As with the other compressed ports, detection has to decompress — which is what
  GARbro does too, since its registry probes the format through `TryOpen` — and the output is capped at
  64 MiB;
* extraction **reserialises** the sound: the `fmt ` chunk's fields go into a canonical 44 byte RIFF header
  and the `data` payload follows. This is what the reference's `RawPcmInput` emits, and it means chunks
  other than `fmt ` and `data` are dropped — a test covers a file carrying a `LIST` chunk between them;
* the entry is named after the source file with a `wav` extension, covers the whole stored file, is flagged
  `compressed: true` and sets `sizeKnown: false` for two reasons at once: the stored stream is compressed
  and the output is a reserialised wave file rather than a copy;
* entry metadata carries `type: "audio"`, and the archive metadata records `audio: "wav"`,
  `compression: "lzss"`, the format tag, channel count, sample rate and bit depth.

The reference class declares no extension list, so the descriptor registers `waz`.

Encoding and archive creation are out of scope.
