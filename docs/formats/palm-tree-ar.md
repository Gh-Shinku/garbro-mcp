# PalmTree AR resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/PalmTree/ArcAR.cs`, classes `ArcOpener` and `ArPkStream`
- GARbro tag: `ARC/AR`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The archive is an ordinary PKWARE container whose three block signatures begin with `AR` instead of `PK`:
the local file header, the central-directory record, and the end-of-central-directory record. GARbro reads it
by wrapping the file in a stream that scans blocks and rewrites those two leading bytes as they are read, so
the ZIP reader sees a normal archive; the port reaches the same result by sharing the PKWARE reader with a
different signature set, which is why that reader now takes its signatures as a parameter.

Only those three signatures are rewritten. ZIP64 records keep their `PK` prefix, so a ZIP64 archive in this
format has no findable end record and is rejected — the same outcome the reference produces.

`ArcOpener.TryOpen` first looks for the central-directory end signature and only then hands the file to its
ZIP reader, and the format carries no signature of its own, relying on the `arc` extension. Everything else —
entry listing, stored and deflated extraction, the unsupported-encryption and unsupported-method errors, and
CP932 names for non-UTF-8 entries — is the behavior described in the PKWARE ZIP port's own note.

## Support

| Capability | Status |
| --- | --- |
| `arc` extension requirement | Supported |
| `AR` signatures for the three ZIP blocks | Supported |
| Central-directory walk and entry listing | Supported through the shared reader |
| Stored and deflated extraction | Supported through the shared reader |
| CP932 names for non-UTF-8 entries | Supported through the shared reader |
| Encrypted and exotic-method entries | Reported as unsupported, as in the port |
| ZIP64 archives | Rejected, as in the reference |
| Archive creation | Unsupported |

Synthetic fixtures cover a stored and a deflated entry behind `AR` signatures, an ordinary `PK` archive,
which the format rejects, and an archive with its end record removed.
