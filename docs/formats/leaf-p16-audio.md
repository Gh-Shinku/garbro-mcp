# Leaf P16 PCM audio

Reference: `GARbro/ArcFormats/Leaf/AudioP16.cs`, class `P16Audio`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/leaf/p16-audio.ts` (`leafP16AudioDescriptor`,
`leafP16AudioFormat`, id `leaf-p16-audio`).

There is no signature: the reference only opens a file whose extension is `P16` and declares it as
raw sixteen bit mono PCM at 44.1 kHz, which it exposes through `RawPcmInput`. The port therefore
gates detection on the extension and wraps the whole file in a wave container:

* the entry is named after the source file with a `wav` extension and covers the whole file;
* extraction prepends the standard 44 byte RIFF/WAVE header
  (`formatTag: 1, channels: 1, sampleRate: 44100, averageBytesPerSecond: 88200, blockAlign: 2,
  bitsPerSample: 16`) with the source length as the data size;
* `sizeKnown` is false because the header is prepended, so the payload is longer than the source;
* entry metadata carries `type: "audio"` and the archive metadata records the PCM parameters.

An empty file is declined. Archive creation and writing are out of scope.
