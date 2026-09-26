# Format notes

One note per ported format, named after the local format id (`<engine>-<format>.md`). A note records the
GARbro reference the port was read from, the layout the format has, where the port deviates from the
reference, and how the port is verified. The authoritative per-format machine-readable record is
`docs/support-status.json`; these notes are the prose beside it.

Notes written later in this project's history are plain language. Notes written earlier use a shorthand in
which ordinary words carry technical meanings that are not defined anywhere: a field column can read
`the name of the entry, of four bytes` where `entry name, four bytes` is meant, and a stream is called a
"walk". In those notes the field names, offsets, code references, tables and verification lists were read
off the reference and can be checked against it; only the sentences around them are affected. Those
sentences are being replaced with plain language as each format is revisited.

Every note names the GARbro baseline commit its claims were read at, so a claim can be re-checked against
the reference tree this project keeps at `./GARbro`.

The reference also carries a table of file-name aliases beside its format registry (`ResourceAlias`); that
table, and how this project stands of it, is written down in `docs/format-aliases.md` rather than in a note
of its own, because it belongs to the registry rather than to one format.
