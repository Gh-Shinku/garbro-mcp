# Red-Zone QDO script

Reference: `GARbro/Legacy/RedZone/ScriptQDO.cs`, class `QdoOpener`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/redzone/qdo-script.ts` (`qdoScriptDescriptor`, `qdoScriptFormat`, id
`redzone-qdo-script`).

A script file with an **obfuscated body and a flag byte that records whether the conversion already
happened**:

| field | offset |
|---|---|
| tag `QDO_SHO` | 0 |
| converted flag | 0xC |
| script body | 0xE |

The reference's `Signature` is the four byte word `QDO_`, but `IsScript` compares **seven** bytes against
`QDO_SHO`. The port registers the four byte signature, as GARbro does, and then re-checks the full seven
byte tag — a test breaks the seventh byte while leaving the registry signature intact, so that second check
is what has to decline the file.

The conversion is `data[i] = (byte)~(data[i] - 13)` applied from `0x0E` to the end. Two details matter more
than the arithmetic:

* the flag byte at `0xC` guards the transform. A non-zero flag means the body is still obfuscated and is
  converted, and the flag is cleared; a zero flag means the file has already been converted and the
  reference returns it **unchanged**. The port reproduces that, and a test feeds it an already converted
  file and asserts not a byte moves. The transform is therefore idempotent, which is a property of the
  reference rather than of this port;
* the inverse, `(byte)(~data[i] + 13)`, is what the reference's own `ConvertBack` applies. The port exports
  it as `encodeQdo` and the test uses it as an oracle: it encodes a buffer, decodes it with the same
  expression the port uses, and asserts the original comes back. The two directions are tied to each other
  rather than each being asserted against a hand-written table.

The port exposes the resource as a single entry:

* the body is rewritten in place and the length never changes, so the entry lists the stored size and sets
  `sizeKnown: true`, the seventh port here to do so. The output is the whole file with the conversion
  applied, not a rebuilt container;
* the entry is named after the source file with a `txt` extension — the body reads as text once converted —
  and is flagged `encrypted`, as is the archive metadata, which also records where the body starts;
* entry metadata carries `type: "script"`.

One deviation: a file without room for the body (`0xE` bytes or fewer) is declined. The reference would
index the flag byte regardless and, for a file of exactly `0xD` bytes, hand back a script with no body.

The reference class declares no extension list, so the descriptor registers none. `ConvertBack` is used
here only to validate the decoder and is not exposed as a creation path.

Archive creation is out of scope.
