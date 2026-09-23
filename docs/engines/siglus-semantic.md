# Siglus semantic adapter

## Purpose and boundary

The first Siglus adapter identifies a game layout for later semantic analysis. It does not decrypt
scene payloads, disassemble bytecode, infer character identities, or execute an engine binary.
Those capabilities belong to separately registered semantic analyzers.

The implementation is an independent TypeScript rewrite informed by
`SiglusSceneScriptUtility`, version-pinned when code is introduced. That project is available under
the Unlicense or 0BSD. Leaked proprietary engine source is not an acceptable reference.

## Structural probe

A 92-byte Scene package header contains its header length, followed by ten offset/count pairs,
then the extra-key and source-header-length words. A structural match requires:

- a 92-byte header and a declared header length of 92;
- monotonically increasing section offsets inside the file;
- the fixed-width variable-info, variable-name-index, command-info, command-name-index,
  scene-name-index, and scene-info sections to occupy exactly eight bytes per record;
- matching counts for each info/name group and for the four scene tables;
- a non-empty scene-data section.

`Gameexe.dat` contributes corroborating evidence when it begins with the observed version words
zero and one. That marker alone is not sufficient to identify Siglus.

Executable inspection is opt-in. When enabled, the adapter validates the DOS and PE headers of a
`SiglusEngine*.exe` file. It reads static bytes only and never starts, loads, injects into, or
modifies the executable. A filename or a valid PE container is corroborating evidence, not a unique
engine signature.

## Outcomes

- A structurally valid Scene package plus a matching Gameexe container is a high-confidence match.
- A structurally valid Scene package without Gameexe corroboration is a medium-confidence match.
- Matching filenames without a valid Scene structure are a low-confidence candidate.
- No relevant files is unsupported.

The structural profile is named `scene-header-92`. It describes the container layout, not the
bytecode constant profile. No semantic predicate is advertised as available until an analyzer that
produces it is registered.

The game fingerprint hashes the selected Scene and Gameexe files, records their relative paths and
sizes, and hashes that stable file manifest. If the caller's input-byte budget is too small, probing
still returns structural evidence but omits the fingerprint with a warning.

## Verification

Redistributable fixtures cover a valid layout, truncated and out-of-range sections, inconsistent
counts, filename-only collisions, Gameexe mismatch, and bounded PE inspection. A private Rewrite
test checks the real installation read-only, verifies the expected adapter result and fingerprint,
and compares source hashes before and after probing.
