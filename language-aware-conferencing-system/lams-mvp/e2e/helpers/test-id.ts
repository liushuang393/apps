/**
 * LAMS MVP シナリオ ID helper
 */
import { test as base, type TestInfo } from "@playwright/test";

export interface ScenarioMeta {
  id: string;
  domain: string;
  description: string;
}

const ID_PATTERN = /^\[([A-Z][A-Z0-9]+-\d{3}(?:-[A-Z]\d+)?)\]\s*(.+)$/;

export function parseScenarioFromTitle(title: string): ScenarioMeta | null {
  const match = ID_PATTERN.exec(title);
  if (!match) return null;
  const id = match[1];
  const description = match[2];
  const domain = id.split("-")[0];
  return { id, domain, description };
}

export function annotateScenario(testInfo: TestInfo): ScenarioMeta | null {
  const meta = parseScenarioFromTitle(testInfo.title);
  if (!meta) {
    testInfo.annotations.push({
      type: "warning",
      description: "テストタイトルに [<ID>] が無い",
    });
    return null;
  }
  testInfo.annotations.push({ type: "scenario-id", description: meta.id });
  testInfo.annotations.push({ type: "scenario-domain", description: meta.domain });
  return meta;
}

export const test = base.extend({});
test.beforeEach(async (_, testInfo) => {
  annotateScenario(testInfo);
});
