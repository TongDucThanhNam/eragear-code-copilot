import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createManagedGoalDiscoveryDraft } from "./managed-goal-discovery";
import { ManagedGoalDiscoveryForm } from "./managed-goal-discovery-dialog";

const DISABLED_START_BUTTON_PATTERN =
  /<button[^>]*disabled=""[^>]*>Start goal discovery/;
const noAction = () => undefined;
const noSubmit = () => undefined;

describe("ManagedGoalDiscoveryForm", () => {
  test("renders an accessible discovery-before-planning form", () => {
    const html = renderToStaticMarkup(
      <ManagedGoalDiscoveryForm
        draft={createManagedGoalDiscoveryDraft()}
        onAction={noAction}
        onCancel={noAction}
        onSubmit={noSubmit}
        project={{ id: "project-eragear", name: "Eragear" }}
      />
    );

    expect(html).toContain("Discovery before planning");
    expect(html).toContain("interview you, challenge assumptions");
    expect(html).toContain("Nothing is dispatched to workers from this step");
    expect(html).toContain(">Project</label>");
    expect(html).toContain('readOnly="" value="Eragear"');
    expect(html).toContain("Locked for this Goal");
    expect(html).toContain("Project ID: project-eragear");
    expect(html).toContain("overflow-y-auto");
    expect(html).toContain("shrink-0 border-t");
    expect(html).toContain("Goal title");
    expect(html).toContain("Rough outcome");
    expect(html).toContain("Discovery depth");
    expect(html).toContain("Quick");
    expect(html).toContain("Thorough");
    expect(html).toContain("Exhaustive");
    expect(html).toContain("External advisors");
    expect(html).toContain("ChatGPT");
    expect(html).toContain("Gemini");
    expect(html).toContain("Start goal discovery");
    expect(html).not.toContain("Plan goal");
    expect(html.match(/type="radio"/g)).toHaveLength(3);
    expect(html.match(/role="checkbox"/g)).toHaveLength(2);
    expect(html.match(/required=""/g)).toHaveLength(2);
  });

  test("exposes validation and submission failures without replacing answers", () => {
    const draft = {
      ...createManagedGoalDiscoveryDraft(),
      title: "Existing title",
      seedIntent: "Existing rough outcome",
    };
    const html = renderToStaticMarkup(
      <ManagedGoalDiscoveryForm
        draft={draft}
        errors={{
          title: "Check the title.",
          seedIntent: "Check the outcome.",
        }}
        onAction={noAction}
        onCancel={noAction}
        onSubmit={noSubmit}
        project={{ id: "project-eragear", name: "Eragear" }}
        submissionError="Advisor unavailable."
      />
    );

    expect(html).toContain('value="Existing title"');
    expect(html).toContain("Existing rough outcome");
    expect(html).toContain("Check the title.");
    expect(html).toContain("Check the outcome.");
    expect(html).toContain("Advisor unavailable.");
    expect(html.match(/role="alert"/g)).toHaveLength(3);
    expect(html.match(/aria-invalid="true"/g)).toHaveLength(2);
  });

  test("locks the form and announces progress while submission is pending", () => {
    const html = renderToStaticMarkup(
      <ManagedGoalDiscoveryForm
        draft={createManagedGoalDiscoveryDraft()}
        onAction={noAction}
        onCancel={noAction}
        onSubmit={noSubmit}
        pending
        project={{ id: "project-eragear", name: "Eragear" }}
      />
    );

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Starting discovery…");
    expect(html.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(6);
  });

  test("disables submission when no runtime callback is connected", () => {
    const html = renderToStaticMarkup(
      <ManagedGoalDiscoveryForm
        draft={createManagedGoalDiscoveryDraft()}
        onAction={noAction}
        onCancel={noAction}
        onSubmit={noSubmit}
        project={{ id: "project-eragear", name: "Eragear" }}
        submitEnabled={false}
      />
    );

    expect(html).toContain("Start goal discovery");
    expect(html).toMatch(DISABLED_START_BUTTON_PATTERN);
  });
});
