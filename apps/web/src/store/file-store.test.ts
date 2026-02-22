import { describe, expect, test } from "bun:test";
import { useFileStore } from "./file-store";

describe("file-store", () => {
  test("upsertFile normalizes and deduplicates file entries", () => {
    useFileStore.setState({
      files: [],
      selectedFile: null,
    });
    const store = useFileStore.getState();

    store.upsertFile("./src\\app.ts");
    store.upsertFile("src/app.ts");

    expect(useFileStore.getState().files).toEqual(["src/app.ts"]);
  });
});
