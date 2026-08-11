import { createHash, timingSafeEqual } from "node:crypto";
import type {
  SupervisorExecutionEnvelope,
  SupervisorTaskRecord,
} from "./supervisor-run.schemas";

export interface SupervisorPlanHashInput {
  version: number;
  summary: string;
  envelope: SupervisorExecutionEnvelope;
  tasks: SupervisorTaskRecord[];
}

export function computeSupervisorPlanHash(
  input: SupervisorPlanHashInput
): string {
  return createHash("sha256")
    .update(canonicalJson(input), "utf8")
    .digest("hex");
}

export function supervisorPlanHashMatches(
  expectedHash: string,
  input: SupervisorPlanHashInput
): boolean {
  const actual = Buffer.from(computeSupervisorPlanHash(input), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function isReplanInsideApprovedEnvelope(input: {
  approved: SupervisorExecutionEnvelope;
  proposed: SupervisorExecutionEnvelope;
}): boolean {
  if (
    input.proposed.goal !== input.approved.goal ||
    input.proposed.delivery.createCommit !==
      input.approved.delivery.createCommit ||
    input.proposed.delivery.targetBranch !==
      input.approved.delivery.targetBranch ||
    input.proposed.delivery.targetHead !== input.approved.delivery.targetHead ||
    input.proposed.delivery.allowDefaultBranch !==
      input.approved.delivery.allowDefaultBranch
  ) {
    return false;
  }
  return (
    isSubset(input.proposed.fileScopes, input.approved.fileScopes) &&
    isSubset(
      input.proposed.verificationCommands,
      input.approved.verificationCommands
    ) &&
    isSubset(input.proposed.successCriteria, input.approved.successCriteria) &&
    isSubset(
      input.proposed.permissionScopes,
      input.approved.permissionScopes
    ) &&
    isSubset(
      input.proposed.destructiveActions,
      input.approved.destructiveActions
    )
  );
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function isSubset(candidate: string[], envelope: string[]): boolean {
  const allowed = new Set(envelope);
  return candidate.every((value) => allowed.has(value));
}
