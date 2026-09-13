# Spiel audio archives (ASD/SPIEL)

## Reference and attribution

- GARbro reference: `Legacy/KApp/ArcASD.cs`, classes `AsdAudioOpener` and `AsdArchive`
- GARbro tag: `ASD/SPIEL`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

## Layout

```
[u8 format at 0x00] [offsets from 0x10] [payloads]
```

The format has no signature: it is gated on the `asd` extension and on a format byte of one or two. The offset
table runs from 0x10 until a 0xFFFFFFFF terminator and its entries are the payload starts, so each payload runs
to the next offset and the last one runs to the end of the file. Names are generated from the archive name as
`NAME#0000`, `NAME#0001` and so on, and every entry is typed as audio.

## Payloads

The extractor dispatches on the format byte:

- format two is mp3: the first word is the data size and the frames start at 0x10;
- format one is a wave: the first word is the pcm size, the wave format sits at 0x08, the pcm starts at 0x20,
  and the extractor writes the same 44 byte RIFF header the KTool opener uses in front of it.

## Port notes and deviations

- The reference reads the offset table without a bound; the port stops at the end of the file.
- Archive creation stays out of scope.

## References

- `GARbro/Legacy/KApp/ArcASD.cs` - `AsdAudioOpener.TryOpen`, `AsdAudioOpener.OpenEntry`
