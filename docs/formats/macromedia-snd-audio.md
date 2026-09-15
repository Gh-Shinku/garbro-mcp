# Macromedia Director audio resource

Reference: `GARbro/ArcFormats/Macromedia/AudioSND.cs`, class `SndAudio`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/macromedia/snd-audio.ts` (`macromediaSndAudioDescriptor`,
`macromediaSndAudioFormat`, id `macromedia-snd-audio`, `readSndLayout`).

The reference registers the word of nothing for this format and tells it apart by the **name** of the file,
which must end with `.snd`, so every file that no other format claimed is offered to it. The word at the start
is `0x0200`, read before the reader turns big endian, and the rest of the header is big endian: a count that
is not nothing, the command `0x8051`, and a position that must stand where those fields end, fourteen bytes
in. Ten bytes on sit the place of the sound — written into the same word the channels of the other encoding
come out of — its rate as a word, and eleven bytes more, the encoding; the byte behind that must be `0x3C`.

Two encodings are read:

* **`0x00`**, an ordinary stream of samples one byte to a sample, which begins at offset thirty six and whose
  count is the place of the sound;
* **`0xFF`**, a stream of samples of two channels or more, whose count of channels is that place, whose count
  of samples is a word at thirty six, whose depth is a word at sixty two and whose samples begin at seventy
  eight.

An encoding that is neither is one the reference **throws** on, which the port reads as a file this format
does not claim, and the depth must be eight or sixteen bits. The stream of samples is offered to the MPEG
Layer 3 format first (`gameres-mp3-audio`): where that takes it, the resource is handed out with an `mp3`
extension and as it stands; otherwise the samples are wrapped in a wave container, whose header is built from
the fields of the resource the way `WaveFormat.SetBPS` builds it — the average bytes a second as the rate
times the channels times the depth, and the **block alignment as the depth in bytes rather than as a frame of
the sound**, which is what the reference sets even for a sound of several channels.

A depth of **sixteen** bits is read **as many bytes as there are samples**, one to a sample rather than two,
which is what the reference asks for; every pair of those bytes is then turned around, because the stream
keeps them big endian, and a stream cut short gives up whatever it holds rather than failing. A depth of eight
bits is taken as it stands. The entry stands where the stream of samples stands, so a resource of the other
encoding has its entry thirty six bytes further in.

The tests cover finding a sound by the name of its file, declining each header the reference does not read,
what the sound behind the header says about itself, a stream of eight bit samples wrapped as it stands, the
pairs of a sixteen bit stream turned around with one byte to a sample, the block alignment one sample wide for
a sound of two channels, a sixteen bit stream cut short, and a stream of MPEG Layer 3 handed out as it stands.
