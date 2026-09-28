import { describe, expect, it, vi } from "vitest";
import { DatasetAnalysis } from "../src/web/analysis/dataset_analysis";
import { profileDataset } from "../src/web/analysis/profiling";
import { scoreIdentityPair, suggestIdentity } from "../src/web/analysis/suggestions";
import { Dataset } from "../src/web/core/types";

const left: Dataset = {
  name: "l", columns: ["person_id", "name", "dept"],
  records: [{ person_id: "1", name: "Ada", dept: "R" }, { person_id: "2", name: "Grace", dept: "R" }, { person_id: "3", name: " ada ", dept: null }],
};
const right: Dataset = {
  name: "r", columns: ["employee_number", "given_name"],
  records: [{ employee_number: "1", given_name: "Ada" }, { employee_number: "2", given_name: "Grace" }],
};

function countsByColumn(spy: { mock: { calls: unknown[][] } }): Record<string, number> {
  const counts: Record<string, number> = Object.create(null);
  for (const [column] of spy.mock.calls) counts[column as string] = (counts[column as string] ?? 0) + 1;
  return counts;
}

describe("profile caching", () => {
  it("computes each column profile and normalized value set once per dataset", () => {
    const analyses = [new DatasetAnalysis(left), new DatasetAnalysis(right)];
    const spies = analyses.map((analysis) => ({
      profile: vi.spyOn(analysis, "computeProfile"),
      values: vi.spyOn(analysis, "computeNormalizedValues"),
    }));
    analyses[0].profiles();
    analyses[1].profiles();
    suggestIdentity(analyses[0], analyses[1]);
    suggestIdentity(analyses[0], analyses[1]);
    scoreIdentityPair(analyses[0], analyses[1], { left_column: "person_id", right_column: "employee_number" });
    scoreIdentityPair(analyses[0], analyses[1], { left_column: "name", right_column: "given_name" });
    analyses.forEach((analysis, index) => {
      const once = Object.fromEntries(analysis.dataset.columns.map((column) => [column, 1]));
      expect(countsByColumn(spies[index].profile)).toEqual(once);
      expect(countsByColumn(spies[index].values)).toEqual(once);
    });
  });

  it("gives the same results as uncached computation", () => {
    const cached = [new DatasetAnalysis(left), new DatasetAnalysis(right)] as const;
    expect(cached[0].profiles()).toEqual(profileDataset(left));
    expect(suggestIdentity(...cached)).toEqual(suggestIdentity(left, right));
    expect(scoreIdentityPair(...cached, { left_column: "name", right_column: "given_name" }))
      .toEqual(scoreIdentityPair(left, right, { left_column: "name", right_column: "given_name" }));
  });
});
