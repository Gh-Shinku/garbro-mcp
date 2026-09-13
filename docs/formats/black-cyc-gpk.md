# Black Cyc GPK images archive

## Reference and attribution

- GARBro reference: `ArcFormats/BlackCyc/ArcGPK.cs`, class `GpkOpener`
- GARBro tag: `GPK`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

A `.gpk` file holds only payload bytes; the index lives in a sibling file that has the same name and
the `.gtb` extension, which GARbro locates with `Path.ChangeExtension`. The record count sits at 0 of
the companion file, followed by a table of name-field offsets, a table of data offsets, and the name
blob. Name offsets are relative to the start of the blob.

Entry names come from the companion file and GARbro appends the `.dwq` container extension to each.
Sizes are derived from consecutive data offsets and the last entry runs to the end of the archive.

## Support

| Capability | Status |
| --- | --- |
| Extension-based detection | Supported |
| Companion `.gtb` index | Supported |
| Companion name offsets and blob | Supported |
| Derived entry sizes | Supported |
| `.dwq` name completion | Supported |
| Entry placement validation | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Image decoding | Not applicable |
| Archive creation | Unsupported |

Synthetic fixtures cover the companion index layout, name completion, payload extraction, and
detection without a companion file.
