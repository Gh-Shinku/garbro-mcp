# Pias resource archive (DAT)

## Reference and attribution

- GARbro reference: `Legacy/Pias/ArcDAT.cs`, classes `DatOpener`, `IndexReader` and `TextReader`
- GARbro tag: `DAT/PIAS`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

## Detection

The format has no reliable signature. Detection is driven entirely by the file name, which GARbro
lowercases before comparing:

| file name               | resource type | directory source   |
| ----------------------- | ------------- | ------------------ |
| `sound.dat`             | sound         | `text.dat`         |
| `graph.dat`             | graphics      | `text.dat`         |
| `voice.dat` `music.dat` | undefined     | the archive itself |
| anything else           | rejected      | -                  |

Sound and graphics archives need a `text.dat` next to them. When it is missing, or its first word is the
encryption marker `0x03184767`, GARbro rejects the archive and the port declines as well.

## The directory

`text.dat` is a sequence of records, each starting with the opcode `0x68`, followed by a resource type, a
count and that many little endian offsets. Integers use a compact big endian encoding where the top two
bits of the first byte select the length: `00` means a single byte, `01` two bytes, `10` three and `11`
four. Records whose type is not the one being looked for are skipped. The record that matches has to
have a sane count, and its offsets are read until the loop breaks.

The offsets become entries numbered by their position: `{index:D4}`, for example `0000`. An offset is read
as a payload length and biased by the entry header size, four bytes for audio and eight for graphics.
Those entries are not placement checked, so their declared size can run past the end of the archive.

Afterwards the whole file is walked as a chain of length prefixed resources. At every position the first
word is read:

- `0xFFFFFFFF` is a four byte gap and produces no entry;
- anything else is a payload length and produces an entry of `length + headerSize` bytes, named after the
  offset in hexadecimal with eight digits, unless an offset from `text.dat` already claimed it.

The walk stops at the end of the file, and an entry that does not fit inside the archive rejects it.

## Extraction

Graphics entries are stored data and are returned as they are, although their declared size includes the
eight byte header bias, so a read is truncated at the end of the archive exactly like GARbro's clamped
`ArcView` streams.

Audio entries are raw 8 bit PCM at 22050 Hz. The first four bytes are a payload length and the rest is
PCM data, which is wrapped into a generated 44 byte RIFF/WAVE container. Archives named `sound.dat` get
two channels, everything else is mono.

## Port notes and deviations

- GARbro reads `text.dat` through the VFS. The port reads it as a companion file next to the archive.
- Reading a partial trailing word at the end of the archive stops the chain walk instead of producing an
  entry from a zero padded read.
- The image decoder (`GraphImageDecoder`, 16 bits per pixel) is out of scope; image entries are extracted
  verbatim.
- Archive creation is out of scope.

## References

- `GARbro/Legacy/Pias/ArcDAT.cs` - `DatOpener.TryOpen`, `IndexReader.FillEntries`,
  `IndexReader.GetName`, `TextReader.GetResourceList`, `TextReader.ReadInt`,
  `DatOpener.OpenAudioEntry`
- `GARbro/GameRes/AudioWAV.cs` - `WaveAudio.WriteRiffHeader`
