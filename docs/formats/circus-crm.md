# Circus CRM image archive

## Reference and attribution

- GARBro reference: `ArcFormats/Circus/ArcCRM.cs`, class `CrmOpener`
- GARBro tag: `CRM`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

A `CRXB` archive stores a 32-bit record count at 8 and an index at 0x10 with 0x20-byte records: the
data offset, one unused 32-bit field, and a 0x18-byte CP932 name at +8. Records carry no sizes.

GARbro collects the offsets into a sorted map and derives each size from the next offset, with the
highest offset running to the end of the file. Records that share an offset collapse in that map, so
only the last record of such a group receives a derived size and the others stay empty.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| 0x20-byte index records | Supported |
| Offset sorting and derived sizes | Supported |
| Shared-offset records | Supported |
| Entry placement validation | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover sorted and out-of-order indexes, shared offsets, signature rejection, and
payload extraction.
