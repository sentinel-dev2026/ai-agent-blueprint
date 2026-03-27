# Skill: Coding

> Structured process for code creation and modification tasks.
> Invoked by the main agent via sub-agent dispatch.

---

## Trigger

Use this skill when the user or main agent requests script creation, tool building, code modification, bug fixes, or automation development.

---

## Process

### Step 1: Receive Specification
- Parse the coding task requirements:
  - **What:** What the code should do (functionality).
  - **Where:** Target file path and language/framework.
  - **Constraints:** Performance, compatibility, style, dependencies.
  - **Context:** Related existing code, if any.

### Step 2: Plan Implementation
- Outline the approach before writing any code:
  - Data structures and algorithms to use.
  - External dependencies (if any — prefer minimal dependencies).
  - Edge cases to handle.
  - File structure (for multi-file tasks).
- For modifications to existing code: read the current file first to understand context.

### Step 3: Write Code
- Follow these principles:
  - **Clarity over cleverness** — readable code is maintainable code.
  - **Minimal scope** — implement exactly what was requested, nothing more.
  - **Error handling** — handle likely failure modes, but don't over-engineer.
  - **Comments** — only where the logic is non-obvious.
- Use the appropriate language conventions and style for the target ecosystem.

### Step 4: Test
- Verify the code works:
  - For scripts: run them if possible and check output.
  - For functions: test with representative inputs including edge cases.
  - For modifications: ensure existing functionality is not broken.
- If testing is not possible in the current environment, document how to test.

### Step 5: Save
- Write the code to the specified output path.
- If the path was not specified, propose a sensible location and confirm.
- Set appropriate file permissions (e.g., `chmod +x` for shell scripts).

---

## Output Format Template

When reporting back to the main agent, use this structure:

```markdown
# Coding Task: [Task Name]

- **Date:** YYYY-MM-DD
- **Language:** [language]
- **Output:** [file path]

---

## Specification
<!-- Brief restatement of what was requested -->

## Implementation Notes
<!-- Key decisions made during implementation -->
- [Decision 1]: [Rationale]
- [Decision 2]: [Rationale]

## Files Created/Modified
- `path/to/file` — [description of what this file does]

## Testing
- [Test 1]: [Result]
- [Test 2]: [Result]

## Known Limitations
<!-- Anything the code doesn't handle, if applicable -->
```

---

## Error Handling

- If the specification is ambiguous, document your interpretation and proceed.
- If a dependency is unavailable, implement without it or suggest an alternative.
- If the task exceeds reasonable scope, implement the core functionality and note what remains.
- Always produce working code, even if partial — indicate what's incomplete.
