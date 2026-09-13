# AbogadoPowers DSK resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/Abogado/ArcDSK.cs`, class `DskOpener`
- GARBro tag: `DSK/PFT`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The payload file has a sibling `.pft` index, which GARbro locates with `Path.ChangeExtension`. The
index starts with a 16-bit header size, a 16-bit cluster size, and a 32-bit record count; records
begin at the header size.

Each record holds a NUL-terminated name of at most eight bytes. An empty name carries no tail, while
every other record continues with a cluster index and the stored size; the data offset is the cluster
index multiplied by the cluster size. GARbro rewrites the stored name extension from a map keyed by
the archive name (`BACK` becomes `KG`, `SCENE` becomes `SCF`, and so on).

## Support

| Capability | Status |
| --- | --- |
| Companion `.pft` index | Supported |
| Header and cluster sizes | Supported |
| Variable-length records with empty-name skipping | Supported |
| Cluster-scaled data offsets | Supported |
| Archive name to extension mapping | Supported |
| Entry placement validation | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the companion index, extension rewriting, empty-name skipping, and
missing-companion rejection.
