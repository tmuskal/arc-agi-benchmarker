/**
 * @process benchmark-plugin-creator
 * @description Create a Claude Code plugin that orchestrates ANY benchmark repo (agentic envs like arc-agi, memory/eval benchmarks like longmemeval, etc.) against a user's setup (harness + plugins + skills + model + MCP servers). Iterative, spec-driven, TDD, adversarial review, converging to >=99% spec parity.
 * @inputs { benchmarkRepoUrl: string, pluginName?: string, outputDir?: string, author?: string, targetHarnesses?: array, additionalRequirements?: string, referenceProcess?: string }
 * @outputs { success: boolean, pluginDir: string, phases: array, finalScore: number, benchmarkType: string, skills: array }
 * @skill plugin-structure specializations/cli-mcp-development/skills/plugin-loader-generator/SKILL.md
 * @agent process-architect specializations/meta/agents/process-architect/AGENT.md
 * @agent quality-assessor specializations/meta/agents/quality-assessor/AGENT.md
 * @agent technical-writer specializations/meta/agents/technical-writer/AGENT.md
 */

import { defineTask } from '@a5c-ai/babysitter-sdk';

/**
 * Generic Benchmark Plugin Creator
 *
 * Given a benchmark repo URL (e.g. https://github.com/arcprize/arc-agi,
 * https://github.com/xiaowu0162/longmemeval), produce a Claude Code plugin
 * that enables users to run that benchmark against their current setup and
 * compare results across setups/harnesses.
 *
 * Supported benchmark families (auto-detected in Phase 1):
 *   - agentic-env      : live interactive envs (arc-agi, babyai, gym-like)
 *   - memory-eval      : long-context / memory benchmarks (longmemeval)
 *   - dataset-qa       : static QA datasets with a judge (mmlu, triviaqa)
 *   - code-eval        : code generation / exec benchmarks (humaneval, swebench)
 *   - tool-use         : tool-calling benchmarks (tau-bench, bfcl)
 *   - generic          : fallback - inputs + expected outputs + scoring
 *
 * Shape of every phase:
 *   1. PLAN     - research, acceptance criteria, spec (adversarially reviewed)
 *   2. BUILD    - TDD implementation with proof-of-correctness artifacts
 *   3. REFINE   - refactor, integrate, update specs, close parity gaps
 * Each phase converges by iterating PLAN/BUILD/REFINE until score >= targetScore
 * or maxConvergenceIterations is reached. A final adversarial review with
 * online research runs at end of each phase and at end of process.
 *
 * Phases:
 *   Phase 1: Benchmark Repo Analysis & Classification
 *   Phase 2: Plugin Architecture & Spec (uses meta/plugin-creation as reference)
 *   Phase 3: Plugin Scaffold + Setup Skill
 *   Phase 4: Core Benchmark Runner Skill (family-specific)
 *   Phase 5: Browse / Report / Compare Skills
 *   Phase 6: Cross-Harness Support (codex/gemini/opencode)
 *   Phase 7: Integration, E2E Smoke Run, Polish, Final Adversarial Review
 */
export async function process(inputs, ctx) {
  const {
    benchmarkRepoUrl,
    pluginName = '',
    outputDir = './plugins',
    author = '',
    targetHarnesses = ['claude-code', 'codex', 'gemini', 'opencode'],
    additionalRequirements = '',
    referenceProcess = 'specializations/meta/plugin-creation'
  } = inputs;

  if (!benchmarkRepoUrl) {
    return {
      success: false,
      error: 'benchmarkRepoUrl is required',
      pluginDir: null,
      phases: [],
      finalScore: 0
    };
  }

  const startTime = ctx.now();
  const targetScore = 99;
  const maxConvergenceIterations = 4;
  const phases = [];
  let runningPluginDir = null;
  let benchmarkProfile = null;

  ctx.log('info', `Starting benchmark-plugin-creator for ${benchmarkRepoUrl}`);

  // ========================================================================
  // PHASE 1 - BENCHMARK REPO ANALYSIS & CLASSIFICATION
  // ========================================================================
  ctx.log('info', '=== PHASE 1: Benchmark Repo Analysis & Classification ===');

  const phase1 = await runConvergentPhase(ctx, {
    phaseNumber: 1,
    phaseName: 'Benchmark Repo Analysis',
    targetScore,
    maxIterations: maxConvergenceIterations,
    planTask: benchmarkAnalysisPlanTask,
    buildTask: benchmarkAnalysisBuildTask,
    refineTask: benchmarkAnalysisRefineTask,
    reviewTask: adversarialReviewTask,
    baseArgs: {
      benchmarkRepoUrl,
      additionalRequirements,
      outputDir
    }
  });
  phases.push(phase1);
  benchmarkProfile = phase1.output?.benchmarkProfile || {};
  if (!pluginName && benchmarkProfile.suggestedPluginName) {
    inputs.pluginName = benchmarkProfile.suggestedPluginName;
  }
  const resolvedPluginName = pluginName || benchmarkProfile.suggestedPluginName || 'benchmark-plugin';
  runningPluginDir = `${outputDir}/${resolvedPluginName}`;

  await ctx.breakpoint({
    question: [
      `Phase 1 complete. Benchmark classified as: ${benchmarkProfile.benchmarkType || 'unknown'}`,
      `Suggested plugin name: ${resolvedPluginName}`,
      `Plugin dir: ${runningPluginDir}`,
      `Score: ${phase1.score}/100`,
      '',
      'Review the benchmark profile, required skills, and plugin name before proceeding to architecture?'
    ].join('\n'),
    title: 'Phase 1 - Benchmark Classification Review',
    context: {
      runId: ctx.runId,
      summary: {
        benchmarkType: benchmarkProfile.benchmarkType,
        pluginName: resolvedPluginName,
        requiredSkills: benchmarkProfile.requiredSkills,
        dependencies: benchmarkProfile.dependencies,
        score: phase1.score
      }
    }
  });

  // ========================================================================
  // PHASE 2 - PLUGIN ARCHITECTURE & SPEC (uses meta/plugin-creation reference)
  // ========================================================================
  ctx.log('info', '=== PHASE 2: Plugin Architecture & Spec ===');
  const phase2 = await runConvergentPhase(ctx, {
    phaseNumber: 2,
    phaseName: 'Plugin Architecture',
    targetScore,
    maxIterations: maxConvergenceIterations,
    planTask: architecturePlanTask,
    buildTask: architectureBuildTask,
    refineTask: architectureRefineTask,
    reviewTask: adversarialReviewTask,
    baseArgs: {
      benchmarkRepoUrl,
      benchmarkProfile,
      pluginName: resolvedPluginName,
      pluginDir: runningPluginDir,
      author,
      targetHarnesses,
      referenceProcess,
      additionalRequirements
    }
  });
  phases.push(phase2);
  const architecture = phase2.output?.architecture || {};

  // ========================================================================
  // PHASE 3 - PLUGIN SCAFFOLD + SETUP SKILL
  // ========================================================================
  ctx.log('info', '=== PHASE 3: Plugin Scaffold + Setup Skill ===');
  const phase3 = await runConvergentPhase(ctx, {
    phaseNumber: 3,
    phaseName: 'Plugin Scaffold + Setup',
    targetScore,
    maxIterations: maxConvergenceIterations,
    planTask: scaffoldPlanTask,
    buildTask: scaffoldBuildTask,
    refineTask: scaffoldRefineTask,
    reviewTask: adversarialReviewTask,
    baseArgs: {
      pluginName: resolvedPluginName,
      pluginDir: runningPluginDir,
      author,
      architecture,
      benchmarkProfile
    }
  });
  phases.push(phase3);

  // ========================================================================
  // PHASE 4 - CORE BENCHMARK RUNNER SKILL (family-specific)
  // ========================================================================
  ctx.log('info', '=== PHASE 4: Core Benchmark Runner Skill ===');
  const phase4 = await runConvergentPhase(ctx, {
    phaseNumber: 4,
    phaseName: 'Benchmark Runner Skill',
    targetScore,
    maxIterations: maxConvergenceIterations,
    planTask: runnerPlanTask,
    buildTask: runnerBuildTask,
    refineTask: runnerRefineTask,
    reviewTask: adversarialReviewTask,
    baseArgs: {
      pluginDir: runningPluginDir,
      architecture,
      benchmarkProfile
    }
  });
  phases.push(phase4);

  // ========================================================================
  // PHASE 5 - BROWSE / REPORT / COMPARE SKILLS
  // ========================================================================
  ctx.log('info', '=== PHASE 5: Browse / Report / Compare Skills ===');
  const phase5 = await runConvergentPhase(ctx, {
    phaseNumber: 5,
    phaseName: 'Browse/Report/Compare Skills',
    targetScore,
    maxIterations: maxConvergenceIterations,
    planTask: auxiliarySkillsPlanTask,
    buildTask: auxiliarySkillsBuildTask,
    refineTask: auxiliarySkillsRefineTask,
    reviewTask: adversarialReviewTask,
    baseArgs: {
      pluginDir: runningPluginDir,
      architecture,
      benchmarkProfile
    }
  });
  phases.push(phase5);

  // ========================================================================
  // PHASE 6 - CROSS-HARNESS SUPPORT
  // ========================================================================
  ctx.log('info', '=== PHASE 6: Cross-Harness Support ===');
  const phase6 = await runConvergentPhase(ctx, {
    phaseNumber: 6,
    phaseName: 'Cross-Harness Support',
    targetScore,
    maxIterations: maxConvergenceIterations,
    planTask: crossHarnessPlanTask,
    buildTask: crossHarnessBuildTask,
    refineTask: crossHarnessRefineTask,
    reviewTask: adversarialReviewTask,
    baseArgs: {
      pluginDir: runningPluginDir,
      architecture,
      benchmarkProfile,
      targetHarnesses
    }
  });
  phases.push(phase6);

  // ========================================================================
  // PHASE 7 - INTEGRATION, E2E SMOKE, POLISH, FINAL ADVERSARIAL REVIEW
  // ========================================================================
  ctx.log('info', '=== PHASE 7: Integration, E2E Smoke, Polish, Final Review ===');
  const phase7 = await runConvergentPhase(ctx, {
    phaseNumber: 7,
    phaseName: 'Integration & Final Review',
    targetScore,
    maxIterations: maxConvergenceIterations,
    planTask: integrationPlanTask,
    buildTask: integrationBuildTask,
    refineTask: integrationRefineTask,
    reviewTask: finalAdversarialReviewTask,
    baseArgs: {
      pluginDir: runningPluginDir,
      architecture,
      benchmarkProfile,
      allPhaseResults: phases
    }
  });
  phases.push(phase7);

  // ========================================================================
  // AGGREGATE
  // ========================================================================
  const scores = phases.map(p => p.score || 0);
  const finalScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  const endTime = ctx.now();

  return {
    success: finalScore >= targetScore,
    pluginName: resolvedPluginName,
    pluginDir: runningPluginDir,
    benchmarkType: benchmarkProfile.benchmarkType,
    skills: architecture.skills || [],
    phases: phases.map(p => ({
      phaseNumber: p.phaseNumber,
      phaseName: p.phaseName,
      iterations: p.iterations,
      score: p.score,
      converged: p.converged
    })),
    finalScore,
    duration: endTime - startTime,
    metadata: {
      processId: 'benchmark-plugin-creator',
      benchmarkRepoUrl,
      targetScore,
      timestamp: startTime
    }
  };
}

// ============================================================================
// CONVERGENT PHASE RUNNER
// ============================================================================

/**
 * Run a phase iteratively: PLAN -> BUILD -> REFINE -> REVIEW, repeating until
 * reviewer score >= targetScore or maxIterations reached. Each iteration feeds
 * prior iteration's artifacts and reviewer feedback into the next plan.
 */
async function runConvergentPhase(ctx, cfg) {
  const {
    phaseNumber, phaseName, targetScore, maxIterations,
    planTask, buildTask, refineTask, reviewTask, baseArgs
  } = cfg;

  let bestOutput = null;
  let bestScore = 0;
  let feedback = null;
  let iteration = 0;
  const iterationLog = [];

  while (iteration < maxIterations) {
    iteration += 1;
    ctx.log('info', `  [phase ${phaseNumber}/${phaseName}] iteration ${iteration}`);

    // PART 1: PLAN
    const plan = await ctx.task(planTask, {
      ...baseArgs,
      phaseNumber,
      phaseName,
      iteration,
      previousFeedback: feedback,
      previousOutput: bestOutput
    });

    // PART 2: BUILD (TDD / proof-of-correctness)
    const build = await ctx.task(buildTask, {
      ...baseArgs,
      phaseNumber,
      phaseName,
      iteration,
      plan,
      previousOutput: bestOutput
    });

    // PART 3: REFINE (refactor, integrate, spec update)
    const refine = await ctx.task(refineTask, {
      ...baseArgs,
      phaseNumber,
      phaseName,
      iteration,
      plan,
      build,
      previousOutput: bestOutput
    });

    const iterOutput = {
      plan, build, refine,
      ...(refine?.output || {}),
      ...(build?.output || {})
    };

    // Adversarial review
    const review = await ctx.task(reviewTask, {
      ...baseArgs,
      phaseNumber,
      phaseName,
      iteration,
      artifactSummary: {
        plan: plan?.summary || null,
        build: build?.summary || null,
        refine: refine?.summary || null
      },
      output: iterOutput
    });

    const score = review?.score ?? 0;
    iterationLog.push({ iteration, score, issues: review?.issues || [] });

    if (score > bestScore) {
      bestScore = score;
      bestOutput = iterOutput;
    }

    feedback = {
      score,
      issues: review?.issues || [],
      recommendations: review?.recommendations || [],
      evidence: review?.evidence || []
    };

    if (score >= targetScore) {
      ctx.log('info', `  [phase ${phaseNumber}] converged at iteration ${iteration} with score ${score}`);
      break;
    }
  }

  return {
    phaseNumber,
    phaseName,
    iterations: iterationLog,
    score: bestScore,
    converged: bestScore >= targetScore,
    output: bestOutput
  };
}

// ============================================================================
// TASK DEFINITIONS
// ============================================================================

// ---------- PHASE 1 : BENCHMARK ANALYSIS ----------
export const benchmarkAnalysisPlanTask = defineTask('benchmark-analysis-plan', (args, taskCtx) => ({
  kind: 'agent',
  title: `Phase 1 / iter ${args.iteration} - Plan benchmark repo analysis`,
  agent: {
    name: 'process-architect',
    prompt: {
      role: 'Benchmark research planner',
      task: `Plan a thorough analysis of the benchmark repo at ${args.benchmarkRepoUrl}`,
      context: args,
      instructions: [
        'Define acceptance criteria for "we understand this benchmark well enough to wrap it as a Claude Code plugin":',
        '  - We know how to install it (lang, package manager, deps, env vars)',
        '  - We know its primary entrypoint(s) to run a benchmark end-to-end',
        '  - We know the shape of inputs (envs, datasets, questions, prompts)',
        '  - We know the shape of outputs (per-item result format, aggregate score)',
        '  - We know the judging / scoring method (rule-based vs. LLM-judge)',
        '  - We know required external services (API keys, HF datasets, GPUs)',
        '  - We know any interaction model (agentic env step/reset vs. static QA)',
        'Plan how to inspect the repo: README, pyproject/setup.py/package.json, CLI entrypoints, examples, tests, config',
        'Plan online research to cross-check claims in the README with the code and issues',
        'If previousFeedback is present, explicitly address each issue raised',
        'Output a written plan + acceptance criteria list'
      ],
      outputFormat: 'JSON with plan (string), acceptanceCriteria (array), researchChecklist (array), summary (string)'
    },
    outputSchema: {
      type: 'object',
      required: ['plan', 'acceptanceCriteria'],
      properties: {
        plan: { type: 'string' },
        acceptanceCriteria: { type: 'array', items: { type: 'string' } },
        researchChecklist: { type: 'array', items: { type: 'string' } },
        summary: { type: 'string' }
      }
    }
  },
  io: { inputJsonPath: `tasks/${taskCtx.effectId}/input.json`, outputJsonPath: `tasks/${taskCtx.effectId}/result.json` },
  labels: ['plan', `phase-${args.phaseNumber}`, 'benchmark-analysis']
}));

export const benchmarkAnalysisBuildTask = defineTask('benchmark-analysis-build', (args, taskCtx) => ({
  kind: 'agent',
  title: `Phase 1 / iter ${args.iteration} - Execute benchmark analysis`,
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Benchmark repo researcher',
      task: `Execute the plan to analyze ${args.benchmarkRepoUrl} and produce a structured benchmarkProfile.`,
      context: args,
      instructions: [
        'Clone or fetch the repo locally in a tmp work dir (git clone --depth 1)',
        'Inspect: README.md, pyproject.toml, setup.py, package.json, requirements*.txt, CLI entrypoints, src/, examples/, tests/',
        'If the repo is large, focus on top-level docs and the 3-5 files named like run_*.py / eval*.py / main.py',
        'Classify the benchmark family: one of [agentic-env, memory-eval, dataset-qa, code-eval, tool-use, generic]',
        'Extract the following into a benchmarkProfile JSON:',
        '  - benchmarkType: the family classification',
        '  - name, description, homepage, licenseHint',
        '  - suggestedPluginName (kebab-case, ends with -benchmarker or similar)',
        '  - language (python|node|go|other), runtimeVersions',
        '  - installCommands (ordered list of shell commands or package-manager ops)',
        '  - dependencies: {packages, datasets, apiKeys, gpuRequired}',
        '  - datasetSources: list of {name, url, format, sizeHint}',
        '  - runEntrypoints: list of {cmd, purpose, inputsShape, outputsShape}',
        '  - interactionModel: one of [episodic-env, batch-qa, conversation-replay, code-exec, tool-call]',
        '  - scoringMethod: {type: "rule"|"llm-judge"|"exact-match"|"regex"|"custom", details, judgeModel, judgePrompt}',
        '  - aggregateMetrics: list (e.g. accuracy, per-category accuracy, win-rate, levels-completed)',
        '  - requiredSkills: list of Claude Code skills the plugin should provide (setup, run-benchmark, browse, report, compare-runs, cross-harness, + family-specific)',
        '  - configSchema: proposed .<plugin>-benchmarks/config.json fields with defaults',
        '  - risks: list of tricky parts (large contexts, rate limits, nondeterminism, flaky judges)',
        '  - referenceAssets: list of file paths inside the repo that are canonical sources of truth',
        'Also produce proof-of-correctness evidence: quoted snippets from the repo (file + line range) that justify each field',
        'If previousFeedback is present, re-run whatever gaps were flagged and improve evidence',
        'Address additionalRequirements if non-empty'
      ],
      outputFormat: 'JSON with benchmarkProfile (object), evidence (array of {field, filePath, lineRange, excerpt}), gaps (array), summary (string)'
    },
    outputSchema: {
      type: 'object',
      required: ['benchmarkProfile', 'evidence'],
      properties: {
        benchmarkProfile: { type: 'object' },
        evidence: { type: 'array' },
        gaps: { type: 'array' },
        summary: { type: 'string' }
      }
    }
  },
  io: { inputJsonPath: `tasks/${taskCtx.effectId}/input.json`, outputJsonPath: `tasks/${taskCtx.effectId}/result.json` },
  labels: ['build', `phase-${args.phaseNumber}`, 'benchmark-analysis']
}));

export const benchmarkAnalysisRefineTask = defineTask('benchmark-analysis-refine', (args, taskCtx) => ({
  kind: 'agent',
  title: `Phase 1 / iter ${args.iteration} - Refine benchmark profile`,
  agent: {
    name: 'quality-assessor',
    prompt: {
      role: 'Benchmark analysis refiner',
      task: 'Refine the benchmarkProfile for completeness, internal consistency, and plug-ability',
      context: args,
      instructions: [
        'Cross-check profile fields against evidence snippets - drop or fix unsupported claims',
        'Ensure suggestedPluginName is kebab-case, unique, and matches the benchmark domain',
        'Ensure configSchema has reasonable defaults for: seeds, max steps/items, result dir, mode',
        'Ensure requiredSkills covers install + run + browse + report + compare + cross-harness + any family-specific skill',
        'Produce a clean benchmarkProfile object, a specDoc markdown, and an open-questions list'
      ],
      outputFormat: 'JSON with benchmarkProfile (object), specDoc (markdown), openQuestions (array), summary (string)'
    },
    outputSchema: {
      type: 'object',
      required: ['benchmarkProfile'],
      properties: {
        benchmarkProfile: { type: 'object' },
        specDoc: { type: 'string' },
        openQuestions: { type: 'array' },
        summary: { type: 'string' }
      }
    }
  },
  io: { inputJsonPath: `tasks/${taskCtx.effectId}/input.json`, outputJsonPath: `tasks/${taskCtx.effectId}/result.json` },
  labels: ['refine', `phase-${args.phaseNumber}`, 'benchmark-analysis']
}));

// ---------- PHASE 2 : PLUGIN ARCHITECTURE ----------
export const architecturePlanTask = defineTask('architecture-plan', (args, taskCtx) => ({
  kind: 'agent',
  title: `Phase 2 / iter ${args.iteration} - Plan plugin architecture`,
  agent: {
    name: 'process-architect',
    prompt: {
      role: 'Claude Code plugin architect',
      task: 'Plan the architecture for a Claude Code plugin that wraps this benchmark',
      context: args,
      instructions: [
        `Use the reference process ${args.referenceProcess} (meta/plugin-creation) as the authoritative pattern for plugin structure`,
        'Define acceptance criteria for the architecture phase:',
        '  - plugin.json schema is valid and Claude Code-loadable',
        '  - Every required skill from benchmarkProfile.requiredSkills has a clear SKILL.md spec',
        '  - Config schema lives under .<plugin>-benchmarks/config.json with harness_config section',
        '  - Result storage format is versioned and cross-harness comparable',
        '  - Cross-harness strategy is instruction-based (generate prompts for codex/gemini/opencode)',
        'Plan the directory tree: plugins/<name>/, plugin.json, README.md, skills/*/SKILL.md, skills/*/scripts/*',
        'Plan the run metadata schema: run-meta.json (model, plugins, skills, mcp_servers, harness), game/item-results.json, scorecard.json',
        'Plan a spec doc to be written and kept in sync with implementation',
        'If previousFeedback, explicitly address each issue'
      ],
      outputFormat: 'JSON with plan (string), acceptanceCriteria (array), architectureSketch (object), summary (string)'
    },
    outputSchema: {
      type: 'object',
      required: ['plan', 'acceptanceCriteria'],
      properties: {
        plan: { type: 'string' },
        acceptanceCriteria: { type: 'array' },
        architectureSketch: { type: 'object' },
        summary: { type: 'string' }
      }
    }
  },
  io: { inputJsonPath: `tasks/${taskCtx.effectId}/input.json`, outputJsonPath: `tasks/${taskCtx.effectId}/result.json` },
  labels: ['plan', `phase-${args.phaseNumber}`, 'architecture']
}));

export const architectureBuildTask = defineTask('architecture-build', (args, taskCtx) => ({
  kind: 'agent',
  title: `Phase 2 / iter ${args.iteration} - Build architecture artifacts`,
  agent: {
    name: 'process-architect',
    prompt: {
      role: 'Plugin architecture builder',
      task: 'Produce concrete architecture artifacts (spec doc, directory tree, plugin.json draft, result schema)',
      context: args,
      instructions: [
        'Write spec.md: sections = Overview, Skills, Configuration, Result Schema, Cross-Harness, Security/Secrets, Versioning',
        'Write directory-tree.txt showing every planned file',
        'Write plugin.json draft with name, version, description, author, skills, keywords',
        'Write result-schema.json defining run-meta.json, item-results.json, scorecard.json (include schema_version)',
        'Draft harness_config schema: {model, plugins, skills, mcp_servers}',
        'For each skill, write a one-paragraph contract (inputs, outputs, side-effects)',
        'Save all artifacts to <pluginDir>-spec/ (alongside, not inside, the plugin dir)'
      ],
      outputFormat: 'JSON with architecture (object with skills[], directoryTree[], pluginJson, resultSchema, harnessConfig), artifacts (array of {path, format}), summary (string)'
    },
    outputSchema: {
      type: 'object',
      required: ['architecture', 'artifacts'],
      properties: {
        architecture: { type: 'object' },
        artifacts: { type: 'array' },
        summary: { type: 'string' }
      }
    }
  },
  io: { inputJsonPath: `tasks/${taskCtx.effectId}/input.json`, outputJsonPath: `tasks/${taskCtx.effectId}/result.json` },
  labels: ['build', `phase-${args.phaseNumber}`, 'architecture']
}));

export const architectureRefineTask = defineTask('architecture-refine', (args, taskCtx) => ({
  kind: 'agent',
  title: `Phase 2 / iter ${args.iteration} - Refine architecture`,
  agent: {
    name: 'quality-assessor',
    prompt: {
      role: 'Architecture refiner',
      task: 'Refactor the architecture for consistency, testability, and compliance with Claude Code plugin conventions',
      context: args,
      instructions: [
        'Validate that every acceptance criterion from plan is satisfied by a concrete artifact',
        'Ensure skills are non-overlapping and composable',
        'Ensure result schema is forward-compatible (schema_version field, optional additive fields)',
        'Update spec.md to reflect final decisions',
        'Produce a parity matrix: spec claim -> artifact location -> test idea'
      ],
      outputFormat: 'JSON with architecture (object), parityMatrix (array), summary (string)'
    },
    outputSchema: {
      type: 'object',
      required: ['architecture'],
      properties: {
        architecture: { type: 'object' },
        parityMatrix: { type: 'array' },
        summary: { type: 'string' }
      }
    }
  },
  io: { inputJsonPath: `tasks/${taskCtx.effectId}/input.json`, outputJsonPath: `tasks/${taskCtx.effectId}/result.json` },
  labels: ['refine', `phase-${args.phaseNumber}`, 'architecture']
}));

// ---------- PHASE 3 : SCAFFOLD + SETUP ----------
export const scaffoldPlanTask = defineTask('scaffold-plan', (args, taskCtx) => ({
  kind: 'agent',
  title: `Phase 3 / iter ${args.iteration} - Plan plugin scaffold + setup skill`,
  agent: {
    name: 'process-architect',
    prompt: {
      role: 'Plugin scaffold planner',
      task: 'Plan the creation of the plugin directory, plugin.json, README, and the setup skill (installer)',
      context: args,
      instructions: [
        'Acceptance criteria:',
        '  - plugin.json validates and loads in Claude Code',
        '  - README.md explains install, setup, run, report, compare',
        '  - skills/setup/SKILL.md is fully self-contained: dependency checks, venv/env creation, API-key guidance, config init, harness_config detection (model+plugins+skills+mcp_servers), environment/dataset scan, end-to-end validation, idempotency',
        '  - Setup skill writes to .<plugin>-benchmarks/config.json with sane defaults, never overwrites user edits',
        'Plan unit-test-like smoke checks the skill must run to self-verify'
      ],
      outputFormat: 'JSON with plan (string), acceptanceCriteria (array), fileManifest (array of {path, purpose}), summary (string)'
    },
    outputSchema: {
      type: 'object',
      required: ['plan', 'acceptanceCriteria', 'fileManifest'],
      properties: {
        plan: { type: 'string' },
        acceptanceCriteria: { type: 'array' },
        fileManifest: { type: 'array' },
        summary: { type: 'string' }
      }
    }
  },
  io: { inputJsonPath: `tasks/${taskCtx.effectId}/input.json`, outputJsonPath: `tasks/${taskCtx.effectId}/result.json` },
  labels: ['plan', `phase-${args.phaseNumber}`, 'scaffold']
}));

export const scaffoldBuildTask = defineTask('scaffold-build', (args, taskCtx) => ({
  kind: 'agent',
  title: `Phase 3 / iter ${args.iteration} - Build plugin scaffold + setup`,
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Plugin scaffold builder (TDD)',
      task: 'Create the plugin directory and setup skill with proof-of-correctness smoke tests',
      context: args,
      instructions: [
        'Create files under args.pluginDir per fileManifest',
        'Write plugin.json with correct schema',
        'Write README.md with install / use / configure sections, with examples',
        'Write skills/setup/SKILL.md following the reference arc-agi-benchmarker setup skill style:',
        '  - step-by-step numbered sections',
        '  - idempotent',
        '  - includes harness_config detection (model from CLAUDE_MODEL or settings.json, plugins from plugin cache dir, mcp_servers from mcp config files, skills from the agent populates based on its own knowledge)',
        '  - includes an end-to-end validation step that exercises the benchmark minimally',
        'Put any non-trivial shell/python code into skills/setup/scripts/*.sh or *.py - SKILL.md references them by relative path',
        'Produce a tests/smoke.* script that the setup skill runs for proof-of-correctness',
        'TDD: write the smoke test first, then make it pass'
      ],
      outputFormat: 'JSON with createdFiles (array of paths), smokeTestResult (object), summary (string)'
    },
    outputSchema: {
      type: 'object',
      required: ['createdFiles'],
      properties: {
        createdFiles: { type: 'array' },
        smokeTestResult: { type: 'object' },
        summary: { type: 'string' }
      }
    }
  },
  io: { inputJsonPath: `tasks/${taskCtx.effectId}/input.json`, outputJsonPath: `tasks/${taskCtx.effectId}/result.json` },
  labels: ['build', `phase-${args.phaseNumber}`, 'scaffold']
}));

export const scaffoldRefineTask = defineTask('scaffold-refine', (args, taskCtx) => ({
  kind: 'agent',
  title: `Phase 3 / iter ${args.iteration} - Refine scaffold + setup`,
  agent: {
    name: 'quality-assessor',
    prompt: {
      role: 'Scaffold refiner',
      task: 'Refactor, close spec-impl gaps, update spec.md',
      context: args,
      instructions: [
        'Re-check every acceptance criterion produces a passing smoke result',
        'Factor duplication across skills into shared scripts/',
        'Update spec.md with the as-built structure and any deviations',
        'Flag residual tech debt with a TODO list'
      ],
      outputFormat: 'JSON with changes (array), techDebt (array), specUpdated (boolean), summary (string)'
    },
    outputSchema: {
      type: 'object',
      required: ['changes'],
      properties: {
        changes: { type: 'array' },
        techDebt: { type: 'array' },
        specUpdated: { type: 'boolean' },
        summary: { type: 'string' }
      }
    }
  },
  io: { inputJsonPath: `tasks/${taskCtx.effectId}/input.json`, outputJsonPath: `tasks/${taskCtx.effectId}/result.json` },
  labels: ['refine', `phase-${args.phaseNumber}`, 'scaffold']
}));

// ---------- PHASE 4 : BENCHMARK RUNNER ----------
export const runnerPlanTask = defineTask('runner-plan', (args, taskCtx) => ({
  kind: 'agent',
  title: `Phase 4 / iter ${args.iteration} - Plan benchmark runner skill`,
  agent: {
    name: 'process-architect',
    prompt: {
      role: 'Benchmark runner planner',
      task: 'Plan skills/run-benchmark/SKILL.md tailored to benchmarkProfile.interactionModel',
      context: args,
      instructions: [
        'Branch behavior by interactionModel:',
        '  - episodic-env: include a persistent driver script that replays action history; include a "no source code reading" rule; include troubleshooting',
        '  - batch-qa: include dataset download, per-item prompting loop, result JSONL format, resume-from-checkpoint',
        '  - conversation-replay: include session loader, long-context handling, judge invocation',
        '  - code-exec: include sandboxing, execution timeouts, test harness',
        '  - tool-call: include tool-schema injection, expected trajectory matching',
        '  - generic: inputs-outputs-scoring tri-loop',
        'Always include: seed handling, max-steps/max-items, max-resets/retries, result dir, recording format',
        'Acceptance criteria must include a TDD-style proof on at least one real item'
      ],
      outputFormat: 'JSON with plan (string), acceptanceCriteria (array), runnerOutline (object), summary (string)'
    },
    outputSchema: {
      type: 'object',
      required: ['plan', 'acceptanceCriteria', 'runnerOutline'],
      properties: {
        plan: { type: 'string' },
        acceptanceCriteria: { type: 'array' },
        runnerOutline: { type: 'object' },
        summary: { type: 'string' }
      }
    }
  },
  io: { inputJsonPath: `tasks/${taskCtx.effectId}/input.json`, outputJsonPath: `tasks/${taskCtx.effectId}/result.json` },
  labels: ['plan', `phase-${args.phaseNumber}`, 'runner']
}));

export const runnerBuildTask = defineTask('runner-build', (args, taskCtx) => ({
  kind: 'agent',
  title: `Phase 4 / iter ${args.iteration} - Build runner skill`,
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Benchmark runner builder (TDD)',
      task: 'Implement skills/run-benchmark/ with SKILL.md + scripts/ following the family pattern',
      context: args,
      instructions: [
        'Write skills/run-benchmark/SKILL.md as step-by-step instructions the agent itself will execute',
        'Extract all non-trivial code into skills/run-benchmark/scripts/*.{py,js,sh}',
        'Write a minimal smoke runner that executes 1-3 items end-to-end for proof-of-correctness',
        'Capture structured results in result-schema format',
        'For episodic-env, include explicit "do NOT read game source" rule and troubleshooting',
        'For batch-qa with an LLM judge, support judge pluggability (Claude or external)',
        'Record harness_config in run-meta.json on every run'
      ],
      outputFormat: 'JSON with createdFiles (array), smokeRunReport (object), summary (string)'
    },
    outputSchema: {
      type: 'object',
      required: ['createdFiles'],
      properties: {
        createdFiles: { type: 'array' },
        smokeRunReport: { type: 'object' },
        summary: { type: 'string' }
      }
    }
  },
  io: { inputJsonPath: `tasks/${taskCtx.effectId}/input.json`, outputJsonPath: `tasks/${taskCtx.effectId}/result.json` },
  labels: ['build', `phase-${args.phaseNumber}`, 'runner']
}));

export const runnerRefineTask = defineTask('runner-refine', (args, taskCtx) => ({
  kind: 'agent',
  title: `Phase 4 / iter ${args.iteration} - Refine runner`,
  agent: {
    name: 'quality-assessor',
    prompt: {
      role: 'Runner refiner',
      task: 'Close gaps between spec and implementation, improve reliability, update spec.md',
      context: args,
      instructions: [
        'Check for nondeterminism and document handling',
        'Check rate-limit / retry strategy',
        'Ensure recordings/logs are machine-readable and human-skimmable',
        'Update spec.md parity matrix'
      ],
      outputFormat: 'JSON with changes (array), risks (array), summary (string)'
    },
    outputSchema: {
      type: 'object',
      required: ['changes'],
      properties: {
        changes: { type: 'array' },
        risks: { type: 'array' },
        summary: { type: 'string' }
      }
    }
  },
  io: { inputJsonPath: `tasks/${taskCtx.effectId}/input.json`, outputJsonPath: `tasks/${taskCtx.effectId}/result.json` },
  labels: ['refine', `phase-${args.phaseNumber}`, 'runner']
}));

// ---------- PHASE 5 : AUXILIARY SKILLS (browse/report/compare) ----------
export const auxiliarySkillsPlanTask = defineTask('aux-skills-plan', (args, taskCtx) => ({
  kind: 'agent',
  title: `Phase 5 / iter ${args.iteration} - Plan browse/report/compare skills`,
  agent: {
    name: 'process-architect',
    prompt: {
      role: 'Auxiliary skills planner',
      task: 'Plan browse-tests, report, compare-runs skills tailored to the benchmark',
      context: args,
      instructions: [
        'browse-tests: list available envs/items with filters, show details, support search',
        'report: summarize a run (aggregate + per-category + per-item), produce markdown',
        'compare-runs: diff two or more runs side-by-side, highlight config and score deltas',
        'Acceptance criteria: each skill works on a real completed run produced in Phase 4'
      ],
      outputFormat: 'JSON with plan (string), acceptanceCriteria (array), summary (string)'
    },
    outputSchema: {
      type: 'object', required: ['plan', 'acceptanceCriteria'],
      properties: { plan: { type: 'string' }, acceptanceCriteria: { type: 'array' }, summary: { type: 'string' } }
    }
  },
  io: { inputJsonPath: `tasks/${taskCtx.effectId}/input.json`, outputJsonPath: `tasks/${taskCtx.effectId}/result.json` },
  labels: ['plan', `phase-${args.phaseNumber}`, 'aux']
}));

export const auxiliarySkillsBuildTask = defineTask('aux-skills-build', (args, taskCtx) => ({
  kind: 'agent',
  title: `Phase 5 / iter ${args.iteration} - Build browse/report/compare`,
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Auxiliary skills builder',
      task: 'Create skills/browse-tests, skills/report, skills/compare-runs',
      context: args,
      instructions: [
        'Each skill: SKILL.md + optional scripts/',
        'Use the result-schema from Phase 2 as the single source of truth',
        'TDD: run the skill against the Phase 4 smoke run output as proof-of-correctness'
      ],
      outputFormat: 'JSON with createdFiles (array), verifications (array), summary (string)'
    },
    outputSchema: {
      type: 'object', required: ['createdFiles'],
      properties: { createdFiles: { type: 'array' }, verifications: { type: 'array' }, summary: { type: 'string' } }
    }
  },
  io: { inputJsonPath: `tasks/${taskCtx.effectId}/input.json`, outputJsonPath: `tasks/${taskCtx.effectId}/result.json` },
  labels: ['build', `phase-${args.phaseNumber}`, 'aux']
}));

export const auxiliarySkillsRefineTask = defineTask('aux-skills-refine', (args, taskCtx) => ({
  kind: 'agent',
  title: `Phase 5 / iter ${args.iteration} - Refine aux skills`,
  agent: {
    name: 'quality-assessor',
    prompt: {
      role: 'Aux refiner',
      task: 'Tighten output consistency, update spec.md',
      context: args,
      instructions: ['Ensure all three skills share identical schema', 'Handle missing-field gracefully', 'Update spec'],
      outputFormat: 'JSON with changes (array), summary (string)'
    },
    outputSchema: { type: 'object', required: ['changes'], properties: { changes: { type: 'array' }, summary: { type: 'string' } } }
  },
  io: { inputJsonPath: `tasks/${taskCtx.effectId}/input.json`, outputJsonPath: `tasks/${taskCtx.effectId}/result.json` },
  labels: ['refine', `phase-${args.phaseNumber}`, 'aux']
}));

// ---------- PHASE 6 : CROSS-HARNESS ----------
export const crossHarnessPlanTask = defineTask('cross-harness-plan', (args, taskCtx) => ({
  kind: 'agent',
  title: `Phase 6 / iter ${args.iteration} - Plan cross-harness`,
  agent: {
    name: 'process-architect',
    prompt: {
      role: 'Cross-harness planner',
      task: 'Plan how to run this benchmark from non-Claude-Code harnesses and import their results',
      context: args,
      instructions: [
        'For each target harness in args.targetHarnesses, define:',
        '  - how to install/launch it',
        '  - the prompt/instruction bundle to hand it (same behavior as Claude Code skill)',
        '  - the expected result location',
        '  - how to import results into this plugin\'s result-schema',
        'Acceptance criteria: a user can copy-paste instructions into codex/gemini/opencode and get comparable results'
      ],
      outputFormat: 'JSON with plan (string), acceptanceCriteria (array), perHarness (object), summary (string)'
    },
    outputSchema: {
      type: 'object', required: ['plan', 'acceptanceCriteria', 'perHarness'],
      properties: { plan: { type: 'string' }, acceptanceCriteria: { type: 'array' }, perHarness: { type: 'object' }, summary: { type: 'string' } }
    }
  },
  io: { inputJsonPath: `tasks/${taskCtx.effectId}/input.json`, outputJsonPath: `tasks/${taskCtx.effectId}/result.json` },
  labels: ['plan', `phase-${args.phaseNumber}`, 'cross-harness']
}));

export const crossHarnessBuildTask = defineTask('cross-harness-build', (args, taskCtx) => ({
  kind: 'agent',
  title: `Phase 6 / iter ${args.iteration} - Build cross-harness`,
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Cross-harness builder',
      task: 'Create skills/cross-harness/ with SKILL.md + per-harness templates',
      context: args,
      instructions: [
        'SKILL.md: how to generate prompts, how to launch each harness, how to import results',
        'scripts/generate-prompt.<py|js>: emits a portable prompt bundle',
        'scripts/import-results.<py|js>: converts harness output into plugin result-schema',
        'TDD: import a synthetic external result and verify compare-runs works'
      ],
      outputFormat: 'JSON with createdFiles (array), verifications (array), summary (string)'
    },
    outputSchema: {
      type: 'object', required: ['createdFiles'],
      properties: { createdFiles: { type: 'array' }, verifications: { type: 'array' }, summary: { type: 'string' } }
    }
  },
  io: { inputJsonPath: `tasks/${taskCtx.effectId}/input.json`, outputJsonPath: `tasks/${taskCtx.effectId}/result.json` },
  labels: ['build', `phase-${args.phaseNumber}`, 'cross-harness']
}));

export const crossHarnessRefineTask = defineTask('cross-harness-refine', (args, taskCtx) => ({
  kind: 'agent',
  title: `Phase 6 / iter ${args.iteration} - Refine cross-harness`,
  agent: {
    name: 'quality-assessor',
    prompt: {
      role: 'Cross-harness refiner',
      task: 'Ensure instructions are harness-accurate and results are comparable',
      context: args,
      instructions: ['Verify prompt bundles do not leak Claude-Code-specific assumptions', 'Normalize all imported results to the same schema version'],
      outputFormat: 'JSON with changes (array), summary (string)'
    },
    outputSchema: { type: 'object', required: ['changes'], properties: { changes: { type: 'array' }, summary: { type: 'string' } } }
  },
  io: { inputJsonPath: `tasks/${taskCtx.effectId}/input.json`, outputJsonPath: `tasks/${taskCtx.effectId}/result.json` },
  labels: ['refine', `phase-${args.phaseNumber}`, 'cross-harness']
}));

// ---------- PHASE 7 : INTEGRATION + FINAL REVIEW ----------
export const integrationPlanTask = defineTask('integration-plan', (args, taskCtx) => ({
  kind: 'agent',
  title: `Phase 7 / iter ${args.iteration} - Plan integration & polish`,
  agent: {
    name: 'process-architect',
    prompt: {
      role: 'Integration planner',
      task: 'Plan the end-to-end smoke run, docs polish, and final adversarial review',
      context: args,
      instructions: [
        'Define the smoke scenario: install plugin -> /setup -> /run-benchmark on 1-2 items -> /report -> /compare-runs (with a seeded reference run)',
        'Plan README polish and top-level installation verification',
        'Plan an online adversarial review that searches for benchmark-family gotchas and checks the plugin handles them'
      ],
      outputFormat: 'JSON with plan (string), acceptanceCriteria (array), summary (string)'
    },
    outputSchema: {
      type: 'object', required: ['plan', 'acceptanceCriteria'],
      properties: { plan: { type: 'string' }, acceptanceCriteria: { type: 'array' }, summary: { type: 'string' } }
    }
  },
  io: { inputJsonPath: `tasks/${taskCtx.effectId}/input.json`, outputJsonPath: `tasks/${taskCtx.effectId}/result.json` },
  labels: ['plan', `phase-${args.phaseNumber}`, 'integration']
}));

export const integrationBuildTask = defineTask('integration-build', (args, taskCtx) => ({
  kind: 'agent',
  title: `Phase 7 / iter ${args.iteration} - Execute integration smoke`,
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Integration executor',
      task: 'Run the full smoke scenario end-to-end and capture evidence',
      context: args,
      instructions: [
        'Install plugin into a clean sandbox-like folder',
        'Run setup -> run-benchmark (tiny slice) -> report -> compare-runs',
        'Collect logs, outputs, and any regressions',
        'Update README with a "Quickstart" that matches what was actually run',
        'REGISTRATION: append the new plugin to the repo marketplace at .claude-plugin/marketplace.json (name, source ./plugins/<pluginName>, description, version, author). Create the file if missing.',
        'REGISTRATION: update the top-level repo README.md to list the new plugin (table row + a short section with install + quickstart + link to plugin README).',
        'GIT: stage plugins/<pluginName>/, .claude-plugin/marketplace.json, README.md, and commit with message "Add <pluginName> plugin" (do NOT push unless the user enabled autoPush).',
        'If input.autoPush is true, run `git push` to the current branch after the commit.'
      ],
      outputFormat: 'JSON with smokeRun (object), evidence (array), regressions (array), marketplaceRegistered (bool), readmeUpdated (bool), commitSha (string|null), pushed (bool), summary (string)'
    },
    outputSchema: {
      type: 'object', required: ['smokeRun', 'marketplaceRegistered', 'readmeUpdated', 'commitSha'],
      properties: {
        smokeRun: { type: 'object' },
        evidence: { type: 'array' },
        regressions: { type: 'array' },
        marketplaceRegistered: { type: 'boolean' },
        readmeUpdated: { type: 'boolean' },
        commitSha: { type: ['string', 'null'] },
        pushed: { type: 'boolean' },
        summary: { type: 'string' }
      }
    }
  },
  io: { inputJsonPath: `tasks/${taskCtx.effectId}/input.json`, outputJsonPath: `tasks/${taskCtx.effectId}/result.json` },
  labels: ['build', `phase-${args.phaseNumber}`, 'integration']
}));

export const integrationRefineTask = defineTask('integration-refine', (args, taskCtx) => ({
  kind: 'agent',
  title: `Phase 7 / iter ${args.iteration} - Polish & finalize`,
  agent: {
    name: 'technical-writer',
    prompt: {
      role: 'Polisher',
      task: 'Finalize README, spec.md, CHANGELOG.md; record any remaining tech debt',
      context: args,
      instructions: [
        'Ensure README covers: install, quickstart, skills, config, cross-harness, troubleshooting',
        'Ensure spec.md parity matrix is 100% green',
        'CHANGELOG: list of what was built per phase'
      ],
      outputFormat: 'JSON with changes (array), remainingDebt (array), summary (string)'
    },
    outputSchema: {
      type: 'object', required: ['changes'],
      properties: { changes: { type: 'array' }, remainingDebt: { type: 'array' }, summary: { type: 'string' } }
    }
  },
  io: { inputJsonPath: `tasks/${taskCtx.effectId}/input.json`, outputJsonPath: `tasks/${taskCtx.effectId}/result.json` },
  labels: ['refine', `phase-${args.phaseNumber}`, 'integration']
}));

// ---------- ADVERSARIAL REVIEW (per-phase) ----------
export const adversarialReviewTask = defineTask('adversarial-review', (args, taskCtx) => ({
  kind: 'agent',
  title: `Adversarial review - phase ${args.phaseNumber} / iter ${args.iteration}`,
  agent: {
    name: 'quality-assessor',
    prompt: {
      role: 'Adversarial reviewer with online research powers',
      task: `Critically review phase ${args.phaseNumber} (${args.phaseName}) artifacts and score 0-100`,
      context: args,
      instructions: [
        'Attack the artifacts: missing evidence, unsupported claims, spec-impl drift, ignored edge cases',
        'Do online research: verify benchmark API claims against upstream docs/issues, verify Claude Code plugin conventions, look for published gotchas',
        'Enumerate specific issues with evidence (quoted + cited)',
        'Score 0-100 where 100 = fully converged, 99+ = ship-ready, <90 = needs another iteration',
        'Provide recommendations that are actionable in the next iteration'
      ],
      outputFormat: 'JSON with score (0-100), issues (array of {severity, issue, evidence}), recommendations (array), evidence (array of URLs/citations), summary (string)'
    },
    outputSchema: {
      type: 'object', required: ['score'],
      properties: {
        score: { type: 'number' },
        issues: { type: 'array' },
        recommendations: { type: 'array' },
        evidence: { type: 'array' },
        summary: { type: 'string' }
      }
    }
  },
  io: { inputJsonPath: `tasks/${taskCtx.effectId}/input.json`, outputJsonPath: `tasks/${taskCtx.effectId}/result.json` },
  labels: ['review', `phase-${args.phaseNumber}`, 'adversarial']
}));

// ---------- FINAL ADVERSARIAL REVIEW ----------
export const finalAdversarialReviewTask = defineTask('final-adversarial-review', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Final adversarial review - whole plugin',
  agent: {
    name: 'quality-assessor',
    prompt: {
      role: 'Final adversarial reviewer',
      task: 'Holistically review the entire plugin for spec parity, tech debt, and ship-readiness',
      context: args,
      instructions: [
        'Open spec.md, README.md, every SKILL.md, every script, the result-schema, and the smoke-run evidence',
        'Check spec-impl parity across all phases - score 0-100',
        'Online research: search for prior art in this benchmark family, incorporate any relevant best practices',
        'Enumerate remaining tech debt with severity and a suggested next-version fix',
        'Produce a final SHIP / NO-SHIP recommendation'
      ],
      outputFormat: 'JSON with score (0-100), shipReady (boolean), issues (array), recommendations (array), techDebt (array), evidence (array), summary (string)'
    },
    outputSchema: {
      type: 'object', required: ['score', 'shipReady'],
      properties: {
        score: { type: 'number' },
        shipReady: { type: 'boolean' },
        issues: { type: 'array' },
        recommendations: { type: 'array' },
        techDebt: { type: 'array' },
        evidence: { type: 'array' },
        summary: { type: 'string' }
      }
    }
  },
  io: { inputJsonPath: `tasks/${taskCtx.effectId}/input.json`, outputJsonPath: `tasks/${taskCtx.effectId}/result.json` },
  labels: ['review', 'final', 'adversarial']
}));
