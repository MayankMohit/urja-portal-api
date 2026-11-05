import type { DataQualityIssue } from './types.js';

export function makeIssue(input: DataQualityIssue): DataQualityIssue {
  const issue: DataQualityIssue = {
    code: input.code,
    severity: input.severity,
    entityType: input.entityType,
    entityId: input.entityId,
    message: input.message,
  };
  if (input.field !== undefined) issue.field = input.field;
  if (input.originalValue !== undefined) issue.originalValue = input.originalValue;
  if (input.repairedValue !== undefined) issue.repairedValue = input.repairedValue;
  return issue;
}
