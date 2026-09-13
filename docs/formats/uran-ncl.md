# Uran resource archives (NCL)

## Reference and attribution

- GARBro reference: `Legacy/Uran/ArcNCL.cs`, class `NclOpener`
- GARBro tag: `NCL`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The archive has no signature, is gated by the `.ncl` extension and is limited to files below 4 GiB. Records are
walked one after another from the start of the file, and a zero size word ends the walk.

## Record layout

```
[u32 stored size] [u32 unpacked size] [u16 name length] [name]
[4 unused bytes] [u16 tail size] [tail size bytes]
[u8 method] [stored size - 1 payload bytes]
```

The name is CP932 and must be between 1 and 0x100 bytes long. The four unused bytes and the tail's size word make
up a six-byte tail that the reader skips, together with as many extra bytes as the size word declares. The stored
size covers the method byte, so the payload itself is `stored size - 1` bytes long, and the whole record advances
the walk by `stored size` from the method byte.

Placement is checked against the record's start and its full stored size before the method byte is read, and names
are listed verbatim because the reference is not hierarchical.

## Stream key and methods

Every byte of a payload is stored with a **stream key of 10 added to it**, including the method byte itself: the
reader subtracts 10 from each byte before it does anything else, and the method it uses is `stored byte − 10` as
well.

| Method | Meaning | Port |
| --- | --- | --- |
| 1 | Payload stored as is | Supported |
| 2 | zlib stream | Supported |
| 3 | bzip2 stream | Unsupported |
| other | The reference falls through and returns the decoded stream | Supported |

Because the method byte is shifted like the payload, a stored method byte of 12 reads as method 2. Packed entries
report the unpacked size from their header as their size and their stored length as their packed size; method 1
entries report the stored length twice.

## Support

| Capability | Status |
| --- | --- |
| `.ncl` extension gate and the 4 GiB file limit | Supported |
| Sequential record walk with a zero size word ending it | Supported |
| Record header, name length bounds and CP932 names | Supported |
| Tail size word and its extra bytes | Supported |
| Stream key subtraction for the method byte and every payload byte | Supported |
| Method 1 stored payloads and method 2 zlib payloads | Supported |
| Other packed methods falling through to the decoded stream | Supported |
| Placement checks against the file size | Supported |
| bzip2 method 3 payloads | Unsupported |
| Archive creation | Unsupported |

Synthetic fixtures cover a stored and a zlib entry, a record whose tail declares extra bytes, a method that falls
through to the decoded stream, a walk ended by a zero size word with trailing junk behind it, a bzip2 payload that
reports an unsupported error, a non-`.ncl` name, a zero and an over-long name length, a payload outside the
archive, an archive without records, a truncated record header, and a payload whose bytes wrap around the stream
key.
