# Eushully resource archives (ALF)

## Reference and attribution

- GARBro reference: `ArcFormats/Eushully/ArcALF.cs`, class `AlfOpener`
- GARBro tag: `ALF`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

An ALF file is a bare blob of payloads, so the format carries no signature and the port registers no signature
hints. What identifies an ALF is a **sibling index file**, which also holds the entry table for every archive of
the game. The port therefore declines any file whose index is missing or unreadable.

## Index candidates

The reference tries three names in order, taking the first that exists **and** parses:

1. `sys4ini.bin`
2. `sys3ini.bin`
3. the archive's own name with an `AAI` extension (for example `data.alf` → `data.AAI`)

## Index containers

| Magic | Index location | Form |
| --- | --- | --- |
| `S4AC` | 0x114 | 32-bit packed size, then an LZSS stream |
| `S4IC` / `S3IC` | 0x134 | 32-bit packed size, then an LZSS stream |
| `S3IN` | 0x12C | Plain, runs from the magic's end to the end of the file |

The LZSS streams use the default GARbro codec settings and are decoded to the end of their block, since the size
field covers the stored stream rather than the unpacked index. Any other magic declines that candidate, and the
next candidate is tried.

## Index contents

The index body starts with a 32-bit archive count, followed by a 0x100-byte name block per archive. A second
32-bit count introduces the file table, whose records are a 0x40-byte name block, a 32-bit archive id, an unused
32-bit file number, a 32-bit payload offset and a 32-bit stored size. Names are decoded to their first NUL byte
while the cursor still advances by the whole fixed block.

Entries named `@` are placeholders and are skipped rather than listed, and an archive id outside the archive
table rejects the whole index — the reference's dictionary lookup cannot succeed for any archive then. Archive
names are matched case-insensitively against the archive's file name, so the table's own casing does not matter.

## Support

| Capability | Status |
| --- | --- |
| `sys4ini.bin`, `sys3ini.bin` and `<archive>.AAI` candidates | Supported |
| `S4AC`, `S4IC`, `S3IC` packed index containers | Supported |
| `S3IN` plain index container | Supported |
| 0x100-byte archive name blocks and 0x40-byte file name blocks | Supported |
| Archive id, file number, offset and size fields | Supported |
| `@` placeholder skipping | Supported |
| Case-insensitive per-archive entry selection | Supported |
| Placement checks on the selected archive's entries | Supported (stricter than the reference) |
| Archive creation | Unsupported |

Two documented deviations:

- The reference memoizes the parsed index per index path in a static field so that opening the second archive of
  a game does not re-read the file. The port re-reads and re-parses the index on every open, which is
  observationally equivalent but slower.
- The reference accepts entries whose payload lies outside the archive; the port declines the index instead.

Synthetic fixtures cover a plain index with two archives, the `S4AC` and `S4IC` layouts, the `AAI` fallback, an
archive the index does not list, a missing index, an unknown magic, an insane archive count, an archive id
outside the table, and an entry outside the archive.
