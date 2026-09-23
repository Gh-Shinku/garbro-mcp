# Contributing

## Commit Messages

Use Conventional Commits and a meaningful scope when possible.

Format:

```text
<type>(<scope>): <description>
```

Examples:

```text
feat(xp3): add archive index parsing

feat(ald): support multi-volume archives

fix(lzss): preserve unsigned 32-bit overflow

test(afa): add extraction golden fixture

docs(xp3): document index encryption

refactor(core): simplify binary reader API

perf(huffman): reduce decoder allocations

chore(deps): update vitest
```

Rules:

* use lowercase type and scope;
* use imperative, concise descriptions;
* do not end the subject with a period;
* keep each commit focused on one logical change;
* do not combine unrelated refactoring with feature work;
* avoid messages such as `update`, `fix stuff`, or `wip`.

## Commit Discipline

Commit completed work promptly instead of accumulating a large working tree. Each commit must have
one explicit logical boundary, include only files required for that change, and leave the repository
in a reviewable state. Before committing, inspect the staged diff and run the checks appropriate to
the changed scope. Keep documentation, infrastructure, codecs, and individual format ports in
separate commits unless they are inseparable parts of the same behavior.

Do not include unrelated changes in a commit. If a task requires several logical changes, finish and
commit each validated change before starting the next one.
