# Lessons Learned

Observations and patterns discovered during development. These are prompt engineering
and AI behaviour insights — practical findings from building this specific tool, not
general theory.

---

### 1. When one variable controls both classification and ordering, ratings drift

**What we observed:**  
The initial `analyze_prd` prompt used a single `risk` field for two purposes at once: classify the importance of each test, and determine its position in the output file ("order output: critical first, then high, medium, low"). After we added the `# source:` field and changed the ordering rule so that direct tests follow source numbering rather than risk, the subsequent run produced generally lower risk ratings across the same content.

**The hypothesis:**  
When risk controls position, there is implicit pressure to rate things higher than they deserve — not because the model is being dishonest, but because it is satisfying both constraints with the same value. A test rated medium will appear after all the highs; if the model considers it important, it may rate it high to ensure prominence. Once position is determined by a different mechanism (source numbering), risk can be assessed independently and the ratings settle closer to their genuine values.

**Why this is a hypothesis and not a certainty:**  
We can't fully isolate the cause. The `# source: direct | suggested` categorisation also changed what Claude was thinking about when it generated each test, the coverage list may have changed between runs, and Claude's outputs have some inherent variability. The correlation between decoupling the two concerns and getting more accurate ratings is consistent, but not experimentally controlled.

**Where this pattern appears in general:**  
Grade inflation in systems where grades determine class rank. Performance review scores when they determine salary bands. In all cases, the metric being used to rank becomes inflated because ranking is the more immediate constraint. Decoupling the metric from the ranking mechanism — using a separate mechanism for ordering — consistently produces more accurate measurement.

---

### 2. Forced categorisation questions reshape generation, not just labelling

**What we observed:**  
Adding a `# source: direct | suggested` field to the `analyze_prd` output changed *what* tests Claude generated, not only how it labelled them. Before the field existed, the output included UI tests for the documentation page alongside API tests — tests that checked whether `/api_list` displayed the correct method names and response codes in the browser. After adding the field, those tests disappeared from the output without being explicitly filtered.

**Why this happened:**  
To assign `source: direct`, Claude must identify which specific numbered API in the documentation each test derives from. A test that checks whether the docs page *displays* the right information cannot be traced back to a specific numbered API endpoint — it is a test of the documentation website, not of the API itself. The categorisation question made that distinction explicit, and Claude stopped generating tests it couldn't categorise as direct.

**The same pattern in two other tools:**  
`investigate_and_fix` requires a `code_bug | app_bug | unclear` verdict before any file patch is written. The model cannot begin patching without committing to a diagnosis, which prevents it from changing a test's assertions to make it pass (an app_bug misclassified as a code_bug). The `spec_file` field in `generate_test` requiring a specific path under `tests/ui/`, `tests/e2e/`, or `tests/api/` similarly constrained what test type the model generated.

**The practical principle:**  
If generated outputs are consistently off-target or mixing domains, adding a forced classification step before generating each item is often more effective than rewording the main instruction. The classification question is not metadata — it is a reasoning step that shapes what gets generated.

---

### 3. Focused context outperforms omniscient context

**What we observed:**  
Early generation calls sent the entire codebase on every request. Switching to focused context — the failing spec and its direct imports for fix calls; fixtures plus feature-matching files for generation calls — improved output quality while also substantially reducing cost.

**Why context volume matters:**  
A model's ability to attend to any particular piece of information decreases as total context grows. When a 120-line POM is surrounded by 4,000 lines of unrelated code, the probability that the model correctly integrates details from it drops. Relevant information competes with noise for the model's attention.

**The secondary benefit:**  
Focused context enables aggressive prompt caching. A stable system prompt and stable codebase context can be cached across calls within a session; only the variable part — the test description, the failure output — needs to be sent in full each time. Cache reads cost roughly 10× less than full input tokens at current Anthropic pricing.

**The practical guidance:**  
Design context loading to answer "what does this specific task actually need?" rather than "what might possibly be relevant?" The cost of including irrelevant context — in both accuracy and money — is higher than the cost of occasionally missing something marginal.

---

### 4. Output format constraints change reasoning, not just output shape

**What we observed:**  
Asking Claude to output a structured JSON plan for POM generation (`{ "poms": [{ "file": "...", "methods": [...] }] }`) produced more thorough POM identification than asking it to "list what pages this test needs." Requiring an array with explicit method names forced enumeration of specific details that a prose response would have generalised over.

**Why this happens:**  
When generating structured output, the model must commit to a value for each field before moving on. An open-ended "list the pages" can be answered at any level of specificity — the model can stop whenever it feels the answer is sufficient. A `"methods": [...]` field requires it to enumerate individual method names, which forces it to reason through the implementation to a greater depth.

**Related observation:**  
The `verdict: "code_bug" | "app_bug" | "unclear"` field in `investigate_and_fix` acts as a forcing function: the model must commit to a diagnosis before any patch is written. This prevents it from writing a patch that changes a test's assertion just to make a failing test pass — a reasonable-seeming action that would misclassify an application defect as a code bug.

---

### 5. Parse defensively — models add preamble text

**What we observed:**  
The orchestrated POM generation flow failed silently on its first real test because Claude prefixed its JSON response with several sentences of reasoning ("Looking at the existing context, I need to understand..."). The `JSON.parse()` call expecting raw JSON threw, and the entire planning step fell back to a less capable path without any indication of what went wrong.

**The fix:**  
`extractJson()` — strip markdown fences first, then attempt direct parse; if that fails, find the outermost `{` and `}` and extract the substring. This is resilient to preamble text while still catching genuinely malformed responses where no valid JSON object exists at all.

**Why it happens:**  
Models don't always comply exactly with format instructions, especially when a task is complex or novel. Adding reasoning before answering is often a sign of higher-quality output, not a compliance failure — the model is showing its work. Treating preamble as an error means rejecting some of the model's best responses.

**The broader principle:**  
Any system that processes model output programmatically should expect format variance. A parser that fails on preamble text fails silently in the worst way: the caller sees no error, proceeds with a fallback or missing result, and the root cause is invisible. Defensive parsing with explicit fallback is not optional.

---

### 6. Planning and execution benefit from different models

**What we observed:**  
Asking one model to both identify which POMs a complex multi-page test needs AND write the TypeScript for all of them produced worse results than splitting the work. The local 14B model frequently missed pages, bundled unrelated pages into one class, or wrote incorrect imports. Using Claude for planning (a JSON list of files and methods) and the local model for execution (write the TypeScript for each individual file) produced better results at lower cost.

**Why the split works:**  
Planning requires reasoning: which pages does a 20-step flow touch? How should responsibilities be partitioned? What method names will be consistent across the spec? A 14B model is not strong at this. Code generation for a single, well-specified page — "write a TypeScript class with these five methods using these locators from this DOM snapshot" — is a mechanical, pattern-matching task; a smaller model handles it accurately and in parallel.

**The cost difference:**  
The planning call produces roughly 400 tokens of output (a JSON list, no code). The code generation calls are free when using a local model. Without the split, all code generation flows through the Claude API.

**The orchestrator-worker pattern:**  
This is a general design principle for multi-step AI workflows. The orchestrator — the larger, reasoning-capable model — determines what needs to be done, in what order, and with what constraints. The workers — smaller, faster, cheaper models — execute specific, bounded tasks. The boundary between them should be drawn where open-ended reasoning ends and constrained execution begins.

---

### 7. Cache what is stable; position volatile content last

**What we observed:**  
Adding `cache_control: { type: "ephemeral" }` to the system prompt and codebase context blocks reduced the cost of repeated generation calls within a session by roughly 10×. Within a 5-minute window, cached tokens are read at a fraction of the full input price.

**How Anthropic's prompt cache works:**  
Caching is prefix-based. If the first N tokens of a request exactly match a cached entry, the cache hit applies. A single changed token anywhere in the cached prefix invalidates the entire cache for that prefix — not just the changed section, but everything that follows it.

**The structural implication:**  
The most stable content must come first. System prompt → codebase context → variable content (test description, failure output). Putting anything that changes between calls — a timestamp, a per-request identifier, the user's current description — anywhere inside the stable prefix breaks caching for everything after it.

**Practical guidance:**  
Before adding anything to the stable section of a prompt, ask: "will this change between calls within the same session?" If yes, it belongs after the last cache breakpoint. Prompt structure is not just an organisation concern — it is a cost architecture decision.
