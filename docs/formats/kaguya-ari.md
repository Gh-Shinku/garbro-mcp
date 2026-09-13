# KaGuYa script engine resource archives (ARC/ARI)

## Reference and attribution

- GARbro reference: `ArcFormats/Kaguya/ArcKaguya.cs`, classes `ArcOpener`, `AriEntry`, `IndexReader`
  and `LzReader`
- GARbro tag: `ARC/ARI`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

## Layout

```
[u8 'WFL1'] [records and payloads]
```

Every record is

| Field | Description |
| --- | --- |
| name length | a 32 bit count |
| name | that many bytes, complemented with 0xFF and read as CP932 |
| mode | 16 bits |
| stored size | 32 bits |
| unpacked size | 32 bits, but only for packed entries |

Payloads follow their record without any padding, so the archive is a single stream of records and payloads and
the payload offsets are not stored anywhere. A packed payload keeps its unpacked size in the four bytes directly
in front of it.

The index can also live in a sibling `ari` file that repeats the same records; when it is used, the archive
itself still carries its own copy of the table, so the payload offsets stay the same. The side index omits the
unpacked size field, which is why the extractor reads that value from the archive.

Modes type the entries: two is audio, one is image, and everything else falls back to the extension, where
`ogg` is audio and `ap`, `aps` and `aps3` are images.

## Payload codec

Packed payloads use an msb first bit stream over a 0x1000 byte frame that starts at position one:

- a set bit reads eight bits and stores them as a literal byte;
- a clear bit reads a twelve bit window offset and four bits of count minus two, and copies that many bytes from
  the frame, byte by byte, so an offset that points at the bytes being written repeats them.

A window offset of zero ends the stream, and so does the end of the input.

## Port notes and deviations

- The reference types untyped entries through the format catalog; the port keeps a small extension list.
- The side index is only tried when the archive name is not already an `ari`.
- Archive creation stays out of scope.

## References

- `GARbro/ArcFormats/Kaguya/ArcKaguya.cs` - `ArcOpener.TryOpen`, `ArcOpener.OpenEntry`,
  `IndexReader.ReadIndex`, `IndexReader.ReadAriIndex`, `IndexReader.BuildIndex`, `IndexReader.DecryptName`,
  `LzReader.Unpack`
