# Skill: Research

> Structured process for web research tasks.
> Invoked by the main agent via sub-agent dispatch.

---

## Trigger

Use this skill when the user or main agent requests information gathering, topic research, competitive analysis, or technology evaluation.

---

## Process

### Step 1: Receive Topic
- Parse the research topic and any constraints (scope, depth, specific questions).
- Identify the desired output format and destination file path.

### Step 2: Plan Queries
- Break the topic into 3–5 specific search queries.
- Prioritize queries by relevance and expected information yield.
- Consider multiple angles: official docs, community discussions, recent news, comparisons.

### Step 3: Execute Web Search
- Run each query systematically.
- For each result:
  - Extract key facts, data points, and quotes.
  - Note the source URL and date.
  - Assess credibility (official docs > blogs > forums).
- If initial queries are insufficient, generate follow-up queries.

### Step 4: Compile Results
- Organize findings into a structured document.
- Remove duplicates and contradictions.
- Highlight areas of consensus and disagreement.
- Note any gaps where information was unavailable.

### Step 5: Save to File
- Write the compiled results to the specified output path.
- Default path: `~/agent/logs/research_<topic_slug>.md`

---

## Output Format Template

```markdown
# Research: [Topic Name]

- **Date:** YYYY-MM-DD
- **Requested by:** [user/main-agent]
- **Queries used:** [list of search queries]

---

## Summary
<!-- 3-5 sentence overview of findings -->

## Key Findings
<!-- Bulleted list of the most important discoveries -->
- Finding 1 ([source](url))
- Finding 2 ([source](url))

## Detailed Notes
<!-- Organized by subtopic -->

### [Subtopic A]
...

### [Subtopic B]
...

## Gaps & Unknowns
<!-- What couldn't be determined -->

## Sources
<!-- Full list of references -->
- [Title](url) — accessed YYYY-MM-DD
```

---

## Error Handling

- If a search query returns no useful results, log it and try an alternative query.
- If the topic is too broad, narrow scope and note the limitation in the output.
- Always produce output, even if results are partial — indicate what's missing.
