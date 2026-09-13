# QLIE engine ABMP resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/Qlie/ArcABMP.cs`, classes `AbmpOpener` and `AbmpReader`, with
  `PackOpener.Decompress` from `ArcFormats/Qlie/ArcQLIE.cs`
- GARbro tag: `ABMP/QLIE`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The signature spells `abmp`, the two bytes behind it are version digits combined into a number that must land
between ten and twelve, and the byte after them must be zero. The index then begins at 0x10 as a series of
sixteen-byte tags, read until one comes up short.

Three tag kinds are understood. `abdata` is a plain payload whose size follows the tag and is named from the
archive with a running number and a `.dat` extension. `abimage10` and `absound10` are containers: a count byte
and then that many sub-records, each carrying its own tag. The remaining tags make a single entry that runs to the
end of the file, named from the archive, a running number and the tag's printable prefix — or `unknown` when the
tag holds unprintable bytes.

The sub-records differ mainly in their names and trailers. `abimgdat15` carries a UTF-16 name behind two length
words, a type byte and a trailer whose length depends on its own version word, and `absnddat12` carries a UTF-16
name and a fixed trailer. Everything else uses a length-prefixed narrow name, with a further byte count and an
extra skip for two of the tags. A stored name whose characters are invalid in a path has them replaced with
underscores, an unnamed record gets a generated name, and a sub-record declaring no size contributes nothing.

## Extraction

A payload whose first word is the sibling pack format's marker is expanded by that codec, which this port shares
through `@garbro-mcp/codecs`; the reference falls back to the stored bytes when its decompressor refuses a
payload, and so does the port. Everything else is emitted verbatim.

## Support

| Capability | Status |
| --- | --- |
| Signature, version range and zero byte | Supported |
| `abmp` extension requirement | Supported |
| Sixteen-byte tag walk | Supported |
| `abdata` records with generated names | Supported |
| Image and sound containers with their counts | Supported |
| UTF-16 and narrow name layouts | Supported |
| Tag-dependent trailers and extra skips | Supported |
| Invalid character replacement and generated names | Supported |
| Unknown tags running to the end of the file | Supported |
| Pack codec expansion with the stored fallback | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover a plain record, a container with a UTF-16-named sub-record, a marked payload expanded by
the shared codec, an unsupported version, and the extension requirement.
