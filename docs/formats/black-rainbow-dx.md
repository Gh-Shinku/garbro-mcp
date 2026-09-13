# DX engine resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/BlackRainbow/ArcDX.cs`, class `PackOpener` and `IndexReader`
- GARBro tag: `PACK/DX`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

A `PACK` archive stores the index length at 4 and keeps its index behind the eight-byte header. The
format is registered for the `pak` extension and the index is recursive: a directory begins with a
record count, and each 0x28-byte record holds a 0x20-byte CP932 name, the offset of a nested index,
and a base offset that is added to every offset in that directory. The nested index offset must lie
behind its own record.

Behind the directory records comes the file count and that many `name, offset, size` records of the
same width. File offsets are relative to the base offset accumulated along the directory path, so
nested directories simply add their own base. Payloads named `*.hse` are stored bitwise inverted and
are inverted back on extraction.

The port rejects archives whose directory records form a cycle instead of recursing without bound as
the reference does.

## Support

| Capability | Status |
| --- | --- |
| Signature and extension detection | Supported |
| Recursive directory index | Supported |
| Nested base-offset accumulation | Supported |
| Nested index offset validation | Supported |
| Cyclic index rejection | Supported |
| `*.hse` payload inversion | Supported |
| Entry placement validation | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover nested directories, several directories, payload inversion, extension
rejection, and nested offset rejection.
