# YaneSDK2 SDA resource archive

## Reference and attribution

- GARBro reference: `Legacy/Yaneurao/ArcSDA.cs`, class `SdaOpener`
- GARBro tag: `SDA/yane`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

An `SQDARC` archive stores a directory count at 0x10 and 0x18-byte directory records from 0x14: the
offset of the directory's first file record, the file count, a ten-byte directory name, and a
four-byte extension. File records are 0x30 bytes wide with a 0x28-byte CP932 name followed by the
data offset and the stored size.

GARbro joins every file name with its directory name and replaces the file extension with the one
stored in the directory record, which is how one physical archive carries differently typed assets.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| Directory records and file counts | Supported |
| Directory-qualified names | Supported |
| Extension rewriting | Supported |
| Entry placement validation | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

GARbro's LZSS path only triggers for packed entries, and its opener creates plain entries, so payloads
are extracted raw. Synthetic fixtures cover the directory walk, name rewriting, signature rejection,
and directory count rejection.
