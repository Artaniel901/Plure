import { DraftId, useComposerDraftStore } from "../../composerDraftStore";
import { expect, it, vi } from "vite-plus/test";

import { act } from "../../../test/render";
import { toastManager } from "../ui/toast";
import { placeLinkedPrompt } from "./linkedPrompt";

it("places the prompt and runs the follow-up action for an empty draft", async () => {
  const target = DraftId.make("linked-prompt-empty");
  const store = useComposerDraftStore.getState();
  const onPlaced = vi.fn();
  using _draft = { [Symbol.dispose]: () => store.clearComposerContent(target) };

  await act(() =>
    placeLinkedPrompt(target, { text: "COO prompt", hiddenCharacters: 0 }, [], onPlaced),
  );

  expect(store.getComposerDraft(target)?.prompt).toBe("COO prompt");
  expect(onPlaced).toHaveBeenCalledOnce();
});

it("defers the follow-up action until an existing draft replacement is confirmed", async () => {
  const target = DraftId.make("linked-prompt-existing");
  const store = useComposerDraftStore.getState();
  const onPlaced = vi.fn();
  let replace: (() => void) | undefined;
  using _draft = { [Symbol.dispose]: () => store.clearComposerContent(target) };
  using _toast = vi.spyOn(toastManager, "add").mockImplementation((toast) => {
    replace = toast.actionProps?.onClick as (() => void) | undefined;
    return "toast-id";
  });
  store.setPrompt(target, "Keep this draft");

  await act(() =>
    placeLinkedPrompt(target, { text: "COO prompt", hiddenCharacters: 0 }, [], onPlaced),
  );

  expect(store.getComposerDraft(target)?.prompt).toBe("Keep this draft");
  expect(onPlaced).not.toHaveBeenCalled();
  await act(() => replace?.());

  expect(store.getComposerDraft(target)?.prompt).toBe("COO prompt");
  expect(onPlaced).toHaveBeenCalledOnce();
});
