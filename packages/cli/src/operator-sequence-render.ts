import type { OperatorReceipt } from "./operator-types.js";

export function renderSequenceOperatorHuman(
  receipt: OperatorReceipt,
): string | null {
  const result = receipt.result;
  if (!result) return null;
  if (result.kind === "sequence_list") {
    return [
      `Fonte Sequences (${result.sequences.length}):`,
      ...(result.sequences.length === 0
        ? ["- none"]
        : result.sequences.map(
            (sequence) =>
              `- ${sequence.sequence_id}; revision ${sequence.revision}; ${sequence.plan.title}.`,
          )),
      "Core effect: none.",
      "",
    ].join("\n");
  }
  if (result.kind === "sequence_draft") {
    return [
      `Fonte Sequence: ${result.outcome ?? "observed"}.`,
      `Sequence/revision: ${result.sequence_id}/${result.revision}.`,
      ...planLines(result.plan),
      `Core effect: ${receipt.core_effect}.`,
      "",
    ].join("\n");
  }
  if (result.kind === "sequence_validation") {
    return [
      "Fonte Sequence definition: valid.",
      ...planLines(result.plan),
      "Core effect: none.",
      "",
    ].join("\n");
  }
  if (result.kind === "sequence_diff") {
    const changes = Array.isArray(result.diff.changes)
      ? result.diff.changes.length
      : "unknown";
    return [
      `Fonte Sequence diff: ${result.sequence_id}.`,
      `Base/current revision: ${result.base_revision}/${result.current_revision}.`,
      `Changed/changes: ${result.diff.changed === true ? "yes" : "no"}/${changes}.`,
      "Core effect: none.",
      "",
    ].join("\n");
  }
  if (result.kind === "sequence_export") {
    return [
      `Fonte Sequence export: ${result.sequence_id}; revision ${result.revision}.`,
      "Use --json for the exact Core definition.",
      "Core effect: none.",
      "",
    ].join("\n");
  }
  if (result.kind === "sequence_simulation") {
    return [
      `Fonte Sequence authoring preview: ${result.sequence_id}; revision ${result.revision}.`,
      "Delivery: not requested.",
      `Simulation: ${JSON.stringify(result.simulation)}.`,
      "Core effect: none.",
      "",
    ].join("\n");
  }
  if (result.kind === "sequence_activation") {
    return [
      `Fonte Sequence activation: ${result.outcome}.`,
      `Sequence/draft revision: ${result.sequence_id}/${result.draft_revision}.`,
      `Activated version: ${result.activated_version.activated_version_id}/${result.activated_version.version}; current: ${result.activated_version.current ? "yes" : "no"}.`,
      `Core effect: ${receipt.core_effect}.`,
      "",
    ].join("\n");
  }
  if(result.kind==="sequence_management")return JSON.stringify(result.data,null,2)+"\n";
  if (result.kind === "sequence_execution") return JSON.stringify(result.data, null, 2) + "\n";
  return null;
}

function planLines(plan: import("./operator-sequence-types.js").SequencePlan): readonly string[] {
  return [
    `Title: ${plan.title}.`,
    `Entry/reentry: ${plan.entry}/${plan.reentry}.`,
    "Steps:",
    ...plan.steps.map((step) =>
      step.kind === "send"
        ? `- send ${step.step_id}; ${step.content}; ${step.subject ?? "subject incomplete"}.`
        : step.kind === "wait_duration" ? `- wait ${step.step_id}; ${step.duration_seconds} seconds.` : `- ${step.kind} ${step.step_id}.`,
    ),
  ];
}
