# Mina scripts archive (PAK/MINA/SPT)

## Reference and attribution

- GARbro reference: `Legacy/Mina/ArcPAK.cs`, class `ScriptPakOpener`
- GARbro tag: `PAK/MINA/SPT`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

## Detection

This opener only accepts files named `script.pak`. The name compared is the lowercased file name, which
matches GARbro's case insensitive path comparison. Because the detection gate is the file name, the other
Mina openers never see such an archive.

## Layout

Entries are laid out back to back with no index.

```
+0            char[]  name, NUL terminated, at most 16 characters
+len(name) + 1 uint32  payload size
+len(name) + 5 byte[]  payload
```

The payload is a sequence of script lines. Every line is a length byte holding the line length minus one,
two bytes that the reader ignores, and the line text. Entries may not leave the archive.

## Extraction

Each line is rotated back into place, one byte at a time, by a rotate right of four bits, and a carriage
return and line feed pair is appended after every line. The output is therefore longer than the stored
entry, so entries report an unknown size until they are decoded. A truncated final line is dropped.

## Port notes and deviations

- Archive creation is out of scope.
- The second and third bytes of every line record are read by the reference but never used, and the port
  ignores them as well.

## References

- `GARbro/Legacy/Mina/ArcPAK.cs` - `ScriptPakOpener.TryOpen`, `ScriptPakOpener.OpenEntry`
