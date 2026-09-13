# Lune Adv Game resource archive (PACK/LUNE)

## Reference and attribution

- GARbro reference: `Legacy/Lune/ArcPACK.cs`, class `PackOpener`
- GARbro tag: `PACK/LUNE`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

## Detection

The format has no signature, so every file is a candidate and the index decides. The first little endian
word is the offset of the payload area, and it doubles as the offset field of the first record. It has to
be larger than eight, smaller than the file, and a multiple of eight. The record count is that offset
divided by eight, which means a one record archive reads as the value eight and is declined.

Every record holds a little endian offset and a little endian stored size. An offset before the payload
area or a record that does not fit in the file declines the archive, and the last listed entry has to end
exactly at the end of the file.

## Entries

Entry names are generated rather than stored: every record becomes `<base>#<index>` with the index padded
to five digits and counted over all record slots, including the ones that are skipped. The base name is the
file name without its extension, replaced by the extension itself when the file name is `pack`, so
`pack.dat` produces `dat#00000`. The entry type follows the file extension: `wda` and `bgm` are audio,
`scr` is a script, and everything else is an image. Records with a zero size are not listed but still
consume their slot.

## Extraction

Stored entries are read verbatim. Audio archives hold raw PCM without a container, so extraction prepends a
44 byte RIFF/WAVE header for mono, sixteen bit PCM: 22050 Hz for `wda` and 44100 Hz for `bgm`, with the
average byte rate derived from the sample rate and the block alignment. Because that header is added, the
extracted size of an audio entry is larger than its stored size and is reported as unknown.

## Port notes and deviations

- Archive creation is out of scope.
- The GARbro image decoders (`PackImageDecoder`, `PackMaskDecoder`, `Pack2ImageDecoder`) are not ported, so
  image entries are extracted verbatim.
- Entry slot numbers keep the position of the record in the index, matching the reference generator.

## References

- `GARbro/Legacy/Lune/ArcPACK.cs` - `PackOpener.TryOpen`, `PackOpener.OpenEntry`
- `GARbro/GameRes/AudioWAV.cs` - `WaveAudio.WriteRiffHeader`
