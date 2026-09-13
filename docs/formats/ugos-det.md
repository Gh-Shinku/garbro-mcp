# μ-GameOperationSystem resource archives (DET)

## Reference and attribution

- GARbro reference: `ArcFormats/uGOS/ArcDET.cs`, classes `DetOpener`, `DetIndexReader` and `RleDecompressor`
- GARbro tag: `DET`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

A DET archive has no signature of its own and keeps its index in sibling files, so the file name and the
companions are what identify it.

## Companions

| File | Role |
| --- | --- |
| `name.det` | the archive itself, holding nothing but payloads |
| `name.nme` | the name table, a flat buffer that index records address by offset |
| `name.atm` | an index of 0x10 byte records |
| `name.at2` | an index of 0x14 byte records |

The name file must exist, and exactly one of the two index files does: `atm` is preferred and `at2` is only
used when it is missing. A present but unreadable `atm` therefore fails the archive even when an `at2` file
sits next to it.

The record count is the index size divided by the record size and must be sane, which means greater than zero
and below 0x40000. Every record holds:

| Offset | Field |
| --- | --- |
| 0x00 | name offset inside the name file |
| 0x04 | payload offset |
| 0x08 | payload size |
| 0x10 | unpacked size, in the 0x14 byte layout only |

Names are CP932 and cut at their first NUL. A name offset outside the name file, an offset that leaves the
archive or an index that cannot be read with its own record size decides the layout: the reader retries the
compact layout with the larger record size before it gives up. A name that ends in `.bmp.txt` marks the entry
as an image.

## Payload encoding

Every payload is compressed with the reference's RLE stream. The stream keeps a 0x100 byte sliding history and
writes every decoded byte into it as well:

| Input | Meaning |
| --- | --- |
| byte other than 0xFF | a literal byte |
| `0xFF 0xFF` | a literal 0xFF |
| `0xFF ctl` | copy `(ctl & 3) + 3` bytes from `(ctl >> 2) + 1` bytes behind the current position |

A copy may overlap its own output, because both the read and the write position advance with every byte. The
compact layout stores no unpacked size, so those payloads are decoded until their input ends; the larger layout
declares a size and the port decodes exactly that many bytes.

## Port notes and deviations

- Detection starts from the `.det` extension, so a file that only looks like an archive is never claimed.
- The reference keeps the whole name file in memory, which the port does as well.
- Archive creation stays out of scope.

## References

- `GARbro/ArcFormats/uGOS/ArcDET.cs` - `DetOpener.TryOpen`, `DetOpener.OpenEntry`, `DetIndexReader.ReadIndex`,
  `RleDecompressor.Unpack`
