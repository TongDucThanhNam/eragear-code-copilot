import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Dialog } from "@/components/ui/dialog";
import { GitDefaultBranchConfirmationContent } from "./git-actions-control";

describe("GitActionsControl protected branch confirmation", () => {
  test("renders branch warning, changed-file summary, and commit message input", () => {
    const html = renderToStaticMarkup(
      createElement(
        Dialog,
        { open: true },
        createElement(GitDefaultBranchConfirmationContent, {
          action: "commit",
          commitMessage: "",
          onCommitMessageChange: () => undefined,
          status: {
            isRepository: true,
            refName: "main",
            hasWorkingTreeChanges: true,
            hasUpstream: true,
            hasPrimaryRemote: true,
            isDefaultRef: true,
            aheadCount: 0,
            behindCount: 0,
            changedFiles: [
              { path: "src/new.ts", status: "added" },
              { path: "src/old.ts", status: "deleted" },
            ],
          },
        })
      )
    );

    expect(html).toContain("Confirm protected branch action");
    expect(html).toContain("main");
    expect(html).toContain("2 files · +1 −1");
    expect(html).toContain("Commit message (optional)");
  });
});
