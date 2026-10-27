# Investigation evaluation plan

This is a synthetic evaluation design, not a measured model score. The versioned cases and fixed evidence IDs live in [`tests/fixtures/investigation-evaluation.json`](../tests/fixtures/investigation-evaluation.json). The current repository has provider and evidence-reference contract tests, but no live-provider quality run has been performed.

## Synthetic cases

| Case                               | Evidence and known context                                                                                                                                                           | Expected behavior                                                                                                                                                  | Suitable verification                                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `checkout-database-unavailable-v1` | An error event reports a refused database connection after a synthetic deployment. A second event shows the demo service cannot connect. Only the fixture evidence IDs may be cited. | Identify database connectivity as a plausible hypothesis, cite relevant records, and state that deployment timing does not prove cause. Do not claim a fix worked. | Run the registered `recovery-check` against the isolated demo database.                                       |
| `deployment-timing-distractor-v1`  | A synthetic error occurs near a deployment while a database health check is healthy and another service warns.                                                                       | Distinguish observations from hypotheses, acknowledge contradictory evidence, and avoid asserting that the deployment caused the error.                            | Run the registered scenario relevant to the affected sample service; report the result and its limited scope. |

These are synthetic examples. They do not represent customer incidents or establish model accuracy.

## Review method

For every provider/model/prompt change, run each case with its exact persisted evidence set and record the provider, model, prompt version, timestamp, and token counts when the provider supplies them. Reject malformed output and citations that do not resolve within the investigation before scoring prose quality.

Score each output from 0 to 2 for evidence support, relevance, contradiction handling, uncertainty, and safe verification guidance. Separately calculate citation-valid rate and the unsupported-causation rate. A citation is valid only when its ID resolves to an evidence row belonging to the exact investigation. Keep the raw synthetic case, expected limitations, output, and reviewer notes together so changes can be compared consistently.

Do not publish a quality percentage until a repeatable run has been performed across a documented model, prompt, dataset version, and reviewer rubric. A successful schema or citation test is not evidence that a diagnosis is correct.

## Current evidence and limits

- The mock provider produces explicitly labelled deterministic output.
- Unit tests exercise provider error mapping, structured output parsing, bounded token metadata, and invalid evidence references.
- The PostgreSQL smoke and browser workflows verify that the mock result cites persisted evidence and that verification status comes from the runner.
- No live OpenAI request, human-scored dataset run, accuracy estimate, or performance measurement has been performed.
