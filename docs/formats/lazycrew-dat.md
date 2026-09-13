# Lazycrew resource archive (DAT/LAZYCREW)

## Reference and attribution

- GARbro reference: `Legacy/Lazycrew/ArcDAT.cs`, class `DatOpener`
- GARbro tag: `DAT/LAZYCREW`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

## Layout

```
index
0x00  int32     directory count, 1 to 20
0x04  dirs      per directory: char[8] name, int32 record offset at +8, int32 count at +12
...   records   per entry: uint16 volume id, uint32 offset at +2, uint32 size at +6
data            payloads inside the volume file the index points at
```

The archive name selects the volume: `0001.dat`, `0002.dat` and so on, or `data`, `data2`. The first volume
carries the index itself, while any other volume reads it from its sibling `0001.dat`, or from `data` when the
name has no `.dat` extension. Because every index describes all volumes, each entry records the id of the
volume its payload lives in, and only the entries matching the requested volume are listed; their offsets are
relative to that volume file.

Entries are named after their directory with a five digit index, without an extension. Directories named
`image` and `sound` type their entries as images and audio respectively, and anything else is typed by name.

Audio entries start with a signature word. `0` and `0x10000` mark a keyed PCM stream that is rewritten into a
RIFF container: the sixteen byte wave format is stored at +4, the data size at +0x16 and the PCM at +0x1A,
where every byte is XORed with the low byte of a rolling key. `1` and `0x10001` mark a plain stream that is
returned without its four byte signature, and any other value is returned verbatim.

## Port notes and deviations

- Image decoding, which for this format handles a small family of compressed bitmap headers, is out of scope,
  as is archive creation.
- Audio entries are reported with an unknown size, since extraction rewrites or trims the stored record.

## References

- `GARbro/Legacy/Lazycrew/ArcDAT.cs` - `DatOpener.TryOpen`, `DatOpener.ReadIndex`, `DatOpener.OpenEntry`,
  `DatOpener.OpenAudio`, `DatOpener.DecryptData`
