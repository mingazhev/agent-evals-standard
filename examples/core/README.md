# Worked example (A1)

- Status: informative example for the unpublished 0.1.0 candidate
- Level: [A1](../../standard/conformance.md#baseline-a1)

This is a complete A1 experiment: one case, its Case QA record, the sealed run
manifest, the attempt ledger, the scorecard, and the conformance statement. It
shows what each artifact contains and how every number is computed.

**The run is synthetic.** "example-model", "example-agent-harness",
"example-codemods", and `ledger-service` are fictional, and the outcomes are a
fixed illustrative design, not a measurement of any real agent. What is real is
the arithmetic: every count, bound, and interval in the scorecard is
reproducible from [`attempt-ledger.json`](attempt-ledger.json) with the rules
below, and every ledger `entryDigest` is the true SHA-256 chain value. The other
49 cases and Case QA records are referenced by path and digest only, and the Git
commits are illustrative identifiers.

## The team

Two people, which the [small-team model](../../standard/glossary.md#independence)
allows for every A1 role:

- `person-a` authors the cases, configures the agent arm, owns the run, and
  issues the conformance statement;
- `person-b` reviews each case's scope and inferability before any result
  exists, and independently reviews the conformance statement.

## Commit order

Integrity is content digests plus Git commit order, per the
[integrity model](../../standard/evidence-and-validation-contract.md#integrity-model).
The commits below are each an ancestor of the next:

| Step | Commit (illustrative) | What it fixes |
| --- | --- | --- |
| 1 | `cases-and-case-qa` | 50 case files and their Case QA records, including `person-b`'s reviews |
| 2 | `run-manifest-sealed` | the run manifest: arms, cases, repetitions, claims, statistics — the seal point |
| 3 | `first-attempt-recorded` | the first ledger entry; step 2 must be its ancestor (`I3`) |
| 4 | `ledger-closed` | the complete hash-chained ledger |
| 5 | `scorecard` | the scorecard |
| 6 | `conformance-statement` | the statement |
| 7 | `independent-review` | `person-b`'s confirmation |

The repository's protected branch rejects history rewrites, so nothing sealed in
step 2 can be edited after results appear in step 3.

## 1. Case — [`case.json`](case.json)

`ls-017` asks the agent to fix refunds that are one cent short (issue LS-417).
It records the four `SCOPE-003` tests as holding, with rationales; one
agent-visible check (the existing unit suite) and one hidden check (a
regression test over 1,000 generated amounts); and two hard gates that catch
the classic shortcuts — weakening tests and editing protected paths. Success is
fixed as "every check and every hard gate passes" (`I1`, `GATE-001`). The hidden test and the
original fix live only in the runner's oracle store, mounted after the agent
exits (`HOLD-001`).

## 2. Case QA — [`case-qa.json`](case-qa.json)

The original fix passes; the unchanged snapshot (`no-op`) and a plausible wrong
fix (`round(amount, 2)` on floats) fail; all three controls are stable over five
runs. `person-b`, who did not write the case and had seen no results, confirmed
that every required behavior is inferable from the agent-visible input and that
all four scope tests hold. The case becomes `active` (`SCOPE-003`, `I12`, `CASE-004`).

## 3. Run manifest — [`run-manifest.json`](run-manifest.json)

Three arms, all scored with the same checks (`VALID-003`):

| Arm | Kind | Trials per case | Identity |
| --- | --- | --- | --- |
| `agent-x` | agent | 3 | model, harness config, prompt, tools, permissions, and budget by version or digest (`SCOPE-001`) |
| `control-codemods` | non-agent control | 1 | six deterministic rewrite rules |
| `no-action` | no-action baseline | 1 | the unchanged snapshot |

Engineers fix these issues by hand today; that incumbent is recorded but not
measured, so no claim compares the agent with it. The environment has no
network and one writable root, enforced by the container rather than by
instructions to the agent (`I7`). The plan uses `stat-defaults-v1` without
overrides and seals three claims:

| Claim | Class | Statement | Rule |
| --- | --- | --- | --- |
| `claim-1` | primary | agent pass@1 exceeds 0.50 | lower limit > 0.50 |
| `claim-2` | primary | agent pass@1 exceeds the control's by more than 0.30 | lower limit > 0.30 |
| `claim-3` | exploratory | report agent pass^3 | report only |

With two primary claims, the defaults set each primary interval to
`1 - 0.05/2 = 97.5%` (Bonferroni).

## 4. Run — [`attempt-ledger.json`](attempt-ledger.json)

The ledger has 253 entries, one per physical attempt, each binding the previous
entry's digest. Three agent attempts hit an infrastructure failure and were
replaced, as the manifest allows once per cell. Two replacements succeeded; the
third replacement failed too, so that cell stays unresolved rather than being
dropped or counted as an agent failure (`RUN-002`, `STAT-002`).

| Arm | Scheduled cells | Physical attempts | Valid trials | Invalid attempts | Replacements | Unresolved cells |
| --- | --- | --- | --- | --- | --- | --- |
| `agent-x` | 150 | 153 | 149 | 4 | 3 | 1 |
| `control-codemods` | 50 | 50 | 50 | 0 | 0 | 0 |
| `no-action` | 50 | 50 | 50 | 0 | 0 | 0 |

## 5. Scorecard — [`scorecard.json`](scorecard.json)

Primary outcomes, hard gates, claim status, and the decision verdict are
separate fields (`OUT-001`, `CLAIM-001`). The decision verdict is `not_applicable` because A1
evidence never supports a governance decision.

| Arm | solved | partial | failed | no relevant result | unsafe policy violation |
| --- | --- | --- | --- | --- | --- |
| `agent-x` | 99 | 11 | 28 | 8 | 3 |
| `control-codemods` | 4 | 0 | 21 | 25 | 0 |
| `no-action` | 0 | 0 | 0 | 50 | 0 |

The three unsafe results are hard-gate failures — two runs weakened a test and
one edited a protected path. They count as failures, and nothing else in the
scorecard can offset them (`I1`).

### Per-case distribution of agent successes

| Successful trials | Cases |
| --- | --- |
| 3 of 3 | 24 |
| 2 of 2 resolved, third cell unresolved | 1 |
| 2 of 3 | 9 |
| 1 of 3 | 7 |
| 0 of 3 | 9 |

### pass@1 of the agent (`claim-1`)

The analysis unit is the case (`STAT-001`). Each case contributes its fraction of
successful trials `y_i`.

- Failure endpoint — the unresolved cell counts as a failure:
  `Σ y_i = 24 + 2/3 + 9·(2/3) + 7·(1/3) = 33.0`, so the mean is `33.0 / 50 = 0.660`
  and the sample standard deviation is `s = 0.3897`.
- Success endpoint — the unresolved cell counts as a success:
  `Σ y_i = 33.333`, mean `0.667`, `s = 0.3927`.
- Identification bounds: `[0.660, 0.667]` (`STAT-002`).
- Interval: `t(0.9875, 49) = 2.3124`, so the lower limit is
  `0.660 − 2.3124 · 0.3897 / √50 = 0.533` and the upper limit is
  `0.667 + 2.3124 · 0.3927 / √50 = 0.795`.

The reported point estimate `0.6667` is the valid-only mean, `(24 + 1 + 9·2/3 + 7·1/3) / 50`, which excludes the unresolved cell (that case contributes `2/2 = 1`) and therefore sits at the success endpoint; the two endpoints above bracket it and the interval is built on the endpoints.

The lower limit 0.533 exceeds 0.50, so `claim-1` is **supported**.

### Agent minus non-agent control (`claim-2`)

The control solved 4 cases, each of which the agent solved 3 of 3. Per-case
differences `d_i = y_i − c_i` give a mean of `0.580` at the failure endpoint
(`s = 0.4141`) and `0.587` at the success endpoint (`s = 0.4182`). The interval
is `0.580 − 2.3124 · 0.4141 / √50 = 0.445` to `0.587 + 2.3124 · 0.4182 / √50 = 0.723`.
The lower limit 0.445 exceeds 0.30, so `claim-2` is **supported**.

### Reported, not claimed

| Metric | Bounds | 95% interval | Method |
| --- | --- | --- | --- |
| agent pass^3 (`claim-3`) | 24/50 = 0.48 to 25/50 = 0.50 | [0.348, 0.634] | Wilson, lower at 24/50, upper at 25/50 |
| control pass@1 | 4/50 = 0.08 | [0.032, 0.188] | Wilson |
| no-action pass@1 | 0/50 = 0.00 | [0.000, 0.071] | Wilson |

The no-action baseline at zero confirms what Case QA already showed: no case
passes without a change.

### What the claims say

Each claim carries its population — 50 bug-fix issues sampled at random from
212 eligible closed issues of one Python service — and its restrictions: no
claim about other repositories, languages, task types, or interaction modes; no
claim against the unmeasured human workflow; and no eligibility for release,
autonomy, or risk-acceptance decisions.

Note how wide the intervals are. Fifty cases with three trials each pin the
agent's pass@1 only to roughly 0.53–0.80. That width is the honest result of
this sample size, and the claims are written so that it is enough.

## 6. Conformance statement — [`conformance-statement.json`](conformance-statement.json)

The statement lists, in `requirementResults`, the 26 requirement IDs registered at
minimum level A1 for the experiment claim (`SCOPE-001` through `CONF-003`), each with `pass`
and evidence locations written as `path@commit#pointer`. `person-b` reviewed it at the
`independent-review` commit and confirmed it, so the derived verdict is
`conforming`.

[`../invalid/conformance-statement.conforming-with-failed-requirement.json`](../invalid/conformance-statement.conforming-with-failed-requirement.json)
shows the schema rejecting a statement that keeps `conforming` after
`STAT-002` fails.

## What this example does not show

- semantic validation: resolving every reference, recomputing the hash chain
  and the statistics, and checking commit ancestry — an implementation's job;
- a judgment-bound case with two independent raters (every check here is
  deterministic);
- anything at A2 or A3, governance, or the decision claim.
