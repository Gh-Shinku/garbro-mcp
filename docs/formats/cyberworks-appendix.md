# WendyBell resource archives (APP/Csystem)

## Reference and attribution

- GARBro reference: `ArcFormats/Cyberworks/ArcAPP.cs`, class `AppOpener`, with the table machinery
  (`TocUnpacker`, `IndexReader`) from `ArcFormats/Cyberworks/ArcDAT.cs`
- GARBro tag: `APP/Csystem`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The archive carries a `count` word whose low byte doubles as the signature, and a table of contents whose head is
two decimal fields of eight digits each. Entry payloads are addressed by absolute file offsets that the reader
rebases by the data area behind the packed table.

## Layout

```
[0x00] i32 count            (low byte 0x2F; the table offset is 4 + count * 2)
[0x04] 4 unused bytes
[0x08 .. table offset]      unused filler
[table offset]       8 digits: unpacked table size
[table offset + 8]   8 digits: packed table size
[table offset + 16]  LZSS stream of the packed table size
[payload area]       entry payloads, at the table's data offset
```

A decimal field stores one digit per byte, most significant digit first, as the digit exclusive-ored with `0x7F`.
The value `0xFF` marks a digit that is skipped, which is how the writer pads a field. The payload area begins at
`table offset + 16 + packed table size`.

### Table of contents

The table is a chain of records. Each record is a size word followed by an identifier, the unpacked size, the
stored size and the payload offset, and then two type bytes.

```
[i32 record size] [u32 identifier] [u32 unpacked size] [u32 stored size] [u32 payload offset] [type bytes]
```

`record size` counts the sixteen field bytes and the type bytes. The identifier is rendered with six digits and
the type bytes complete it as an extension when they are printable CP932-free ASCII: a two-byte extension when
both bytes are printable and a one-byte extension otherwise. Payload offsets are relative to the data area and
are rebased when the entry is read, so the archive cannot be relocated without rewriting the table.

An entry is packed when its unpacked and stored sizes differ. Payloads that leave the archive are dropped from
the listing rather than rejecting the archive; an archive whose table yields no entries is declined.

## Detection

The first byte must be `0x2F`, because it is the low byte of the count word. The count word then has to place the
table in the second half of the file: `table offset = 4 + count * 2` must be larger than four and smaller than
the file size. The table must parse as described above.

## Listing and extraction

Entry names come from the table, so an archive without a parseable type byte lists entries such as `000007`,
while the usual archives list `000001.b0`. The entry type is recorded in the metadata as `image` or `audio`, and
extensions in `b0`, `n0`, `o0`, `0b`, `w0` mark the archive as carrying images, which in GARbro selects the
image decryption scheme. Extraction writes stored payloads directly and unpacks packed ones as LZSS streams with
GARbro's default frame settings.

## Deviations from GARbro

- Image payloads are returned as stored: GARbro hands them to a scheme-driven image decoder that is out of scope
  for this port, so the scheme lookup is not attempted and the metadata only records that the archive carries
  images.
- GARbro reads decimal digits and payload bytes through bounds-checking streams, which decline the archive when a
  field runs past the end of the file. This port bounds-checks the same reads.
- A packed table that decodes to more bytes than it declares is accepted and truncated, mirroring the reference,
  which reads exactly the declared size. A table stream that ends early declines the archive.

## Tests

`tests/formats/cyberworks-appendix.test.ts` builds tables in memory and covers typed names, stored and packed
entries, untyped records, dropped out-of-range records, the signature byte, an out-of-range table offset, the
declared size limits of a table, an empty table and malformed record sizes.
