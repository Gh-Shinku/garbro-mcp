# AGENTS.md

## Project Scope

This project reimplements ADV / Galgame resource formats based on GARBro as a reference implementation.

Primary goals:

* Reimplement supported archive and resource formats in TypeScript.
* Keep format implementations modular and independently testable.
* Use GARBro as a behavioral reference, not as an architectural template.
* Prefer correctness and verifiability over premature optimization.
* Expose core functionality through both CLI and MCP.

The MCP layer must remain thin. Core parsing and extraction logic must not depend on MCP-specific APIs.

## Commit Messages

Use conventional commits and a meaningful scope when possible.

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

Do not include unrelated user changes in a commit. If a task requires several logical changes,
finish and commit each validated change before starting the next one.

## Agent Workflow

When implementing a format, follow this order:

```text
1. Inspect repository conventions.
2. Locate GARBro reference implementation.
3. Identify dependent codecs and helpers.
4. Write or update format notes.
5. Implement the smallest useful functionality.
6. Add tests.
7. Compare against GARBro.
8. Run lint, typecheck, and tests.
9. Review the diff for unrelated changes.
10. Commit using Conventional Commits.
```
