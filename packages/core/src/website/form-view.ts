import type { PublicWebsiteFormV1, WebsitePlacementV1 } from "./contract.js";
import { createFormSubmission, type SubmitWebsiteForm } from "./form-submit.js";

const text = <K extends keyof HTMLElementTagNameMap>(tag: K, copy: string) => {
  const node = document.createElement(tag);
  node.textContent = copy;
  return node;
};
function focusedElement(): Element | null {
  let element = document.activeElement;
  while (element?.shadowRoot?.activeElement)
    element = element.shadowRoot.activeElement;
  return element;
}

/** One renderer for every presentation; all content and styles are shadow-owned. */
export function createFormView(options: {
  placement: WebsitePlacementV1;
  parent: Element;
  stylesheetUrl: string;
  submit: SubmitWebsiteForm;
  ready: () => void;
  failed: () => void;
  dismissed: () => void;
}) {
  const overlay = options.placement.presentation !== "inline";
  let active = true;
  let loaded = false;
  let shown = false;
  let terminal = false;
  let requiresReview = false;
  let unavailable = false;
  let current = options.placement.form;
  let latest: PublicWebsiteFormV1 | null = null;
  let email: HTMLInputElement | null = null;
  let firstName: HTMLInputElement | null = null;
  let formElement: HTMLFormElement | null = null;
  let submitButton: HTMLButtonElement | null = null;
  let message: HTMLParagraphElement | null = null;
  let review: HTMLButtonElement | null = null;
  let dialog: HTMLDialogElement | null = null;
  let opener: Element | null = null;
  const host = document.createElement("fonte-form");
  const shadow = host.attachShadow({ mode: "open" });
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = options.stylesheetUrl;
  shadow.append(link);

  const submission = createFormSubmission(
    options.submit,
    (result) => {
      if (active && !host.isConnected) return destroy();
      if (!active || !message) return;
      switch (result.kind) {
        case "received":
        case "completed":
        case "confirmation_required":
          message.textContent =
            result.kind === "received"
              ? "Your request has been received."
              : result.kind === "completed"
                ? current.successMessage
                : "Check your inbox to confirm your subscription.";
          terminal = true;
          clearInputs();
          formElement?.remove();
          formElement = null;
          submitButton = null;
          review?.remove();
          review = null;
          latest = null;
          break;
        case "invalid":
          message.textContent =
            result.field === "email"
              ? "Enter a valid email address."
              : result.field === "firstName"
                ? "Check your first name."
                : "Check the form and try again.";
          if (result.field === "email")
            email?.setAttribute("aria-invalid", "true");
          if (result.field === "firstName")
            firstName?.setAttribute("aria-invalid", "true");
          break;
        case "revision_changed":
          requiresReview = true;
          message.textContent =
            "This form has changed. Review the updated form before submitting.";
          updateReview();
          break;
        case "unavailable":
          unavailable = !result.retryable;
          message.textContent = result.retryable
            ? "Your request could not be confirmed. You can retry."
            : "This form is currently unavailable.";
          if (submitButton) {
            submitButton.disabled = !result.retryable || requiresReview;
            submitButton.textContent = result.retryable
              ? "Retry"
              : current.submitLabel;
          }
      }
    },
    (busy) => {
      if (!active) return;
      if (submitButton)
        submitButton.disabled = busy || requiresReview || unavailable;
      if (email) email.disabled = busy;
      if (firstName) firstName.disabled = busy;
      if (review) review.disabled = busy || !latest;
      formElement?.setAttribute("aria-busy", String(busy));
    },
  );
  function clearInputs() {
    if (email) email.value = "";
    if (firstName) firstName.value = "";
    email = null;
    firstName = null;
  }
  function updateReview() {
    if (!review) return;
    review.hidden = !latest && !requiresReview;
    review.disabled = submission.busy || !latest;
    const copy = latest
      ? "Review updated form"
      : "Updated form is not available yet";
    if (review.textContent !== copy) review.textContent = copy;
    if (submitButton)
      submitButton.disabled = submission.busy || requiresReview || unavailable;
  }
  const edited = () => {
    if (!active) return;
    submission.change();
    email?.removeAttribute("aria-invalid");
    firstName?.removeAttribute("aria-invalid");
    if (submitButton) submitButton.textContent = current.submitLabel;
  };
  const send = (event: SubmitEvent) => {
    event.preventDefault();
    if (
      !active ||
      requiresReview ||
      unavailable ||
      terminal ||
      !email ||
      !formElement?.reportValidity()
    )
      return;
    submission.attempt(current, {
      email: email.value,
      ...(firstName ? { firstName: firstName.value } : {}),
    });
  };
  const acceptReview = () => {
    if (!active || submission.busy || !latest) return;
    current = latest;
    latest = null;
    requiresReview = false;
    unavailable = false;
    submission.change();
    clearInputs();
    render();
    email?.focus();
  };
  const close = () => {
    if (!active) return;
    options.dismissed();
    destroy();
  };
  const cancel = (event: Event) => {
    event.preventDefault();
    close();
  };
  const containKeyboard = (event: KeyboardEvent) => {
    if (!active || event.key !== "Tab" || !dialog) return;
    const controls = [
      ...dialog.querySelectorAll<HTMLElement>(
        "button:not(:disabled), input:not(:disabled)",
      ),
    ].filter((node) => !node.closest("[hidden]"));
    const first = controls[0];
    const last = controls[controls.length - 1];
    const focused = focusedElement();
    if (
      first &&
      last &&
      (!focused ||
        !controls.includes(focused as HTMLElement) ||
        (event.shiftKey && focused === first) ||
        (!event.shiftKey && focused === last))
    ) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
  };
  function render() {
    if (!active) return;
    const panel = text("section", "");
    panel.className = "panel";
    panel.setAttribute("aria-labelledby", "fonte-heading");
    const heading = text("h2", current.headline);
    heading.id = "fonte-heading";
    panel.append(heading, text("p", current.description));
    const scope = text("p", current.scopeLabel);
    scope.className = "scope";
    panel.append(
      scope,
      text(
        "p",
        current.confirmation === "double_opt_in"
          ? "You will need to confirm your subscription by email."
          : "Submitting this form requests a subscription.",
      ),
    );
    formElement = document.createElement("form");
    const field = (
      labelCopy: string,
      name: string,
      type: string,
      required: boolean,
    ) => {
      const label = text("label", labelCopy);
      const input = document.createElement("input");
      input.name = name;
      input.type = type;
      input.required = required;
      input.autocomplete = name === "email" ? "email" : "given-name";
      input.addEventListener("input", edited);
      label.append(input);
      formElement!.append(label);
      return input;
    };
    email = field("Email address", "email", "email", true);
    firstName = current.firstNameEnabled
      ? field("First name", "firstName", "text", false)
      : null;
    submitButton = text("button", current.submitLabel);
    submitButton.type = "submit";
    formElement.append(submitButton);
    formElement.addEventListener("submit", send);
    message = text("p", "");
    message.setAttribute("role", "status");
    message.setAttribute("aria-live", "polite");
    review = text("button", "Review updated form");
    review.type = "button";
    review.hidden = true;
    review.addEventListener("click", acceptReview);
    panel.append(formElement, message, review);
    if (overlay) {
      const closeButton = text("button", "Close");
      closeButton.type = "button";
      closeButton.className = "close";
      closeButton.addEventListener("click", close);
      panel.prepend(closeButton);
      if (!dialog) {
        dialog = document.createElement("dialog");
        dialog.className = options.placement.presentation;
        dialog.setAttribute("aria-labelledby", "fonte-heading");
        dialog.addEventListener("cancel", cancel);
        dialog.addEventListener("close", close);
        dialog.addEventListener("keydown", containKeyboard);
        shadow.append(dialog);
      }
      dialog.replaceChildren(panel);
    } else {
      shadow.replaceChildren(link, panel);
    }
  }
  const fail = () => {
    if (!active) return;
    options.failed();
    destroy();
  };
  const load = () => {
    if (!active || loaded || !host.isConnected) return;
    loaded = true;
    render();
    if (overlay) {
      if (!dialog || typeof dialog.showModal !== "function") return fail();
      try {
        opener = focusedElement();
        dialog.showModal();
        shown = true;
        email?.focus();
      } catch {
        return fail();
      }
    }
    options.ready();
  };
  link.addEventListener("load", load);
  link.addEventListener("error", fail);
  options.parent.append(host);
  function destroy() {
    if (!active) return;
    const focused = focusedElement();
    const restore =
      shown &&
      (document.activeElement === host ||
        (focused !== null && shadow.contains(focused)));
    active = false;
    submission.destroy();
    clearInputs();
    link.removeEventListener("load", load);
    link.removeEventListener("error", fail);
    formElement?.removeEventListener("submit", send);
    review?.removeEventListener("click", acceptReview);
    dialog?.removeEventListener("cancel", cancel);
    dialog?.removeEventListener("close", close);
    dialog?.removeEventListener("keydown", containKeyboard);
    dialog?.close();
    host.remove();
    shadow.replaceChildren();
    if (restore && opener?.isConnected && opener instanceof HTMLElement)
      opener.focus();
    opener = null;
    formElement = null;
    submitButton = null;
    message = null;
    review = null;
    dialog = null;
    latest = null;
  }
  return {
    host,
    destroy,
    update(next: PublicWebsiteFormV1) {
      if (!active || terminal) return;
      if (
        next.publicId === current.publicId &&
        next.publishedRevision === current.publishedRevision
      ) {
        latest = null;
        updateReview();
        return;
      }
      if (
        submission.busy ||
        email?.value ||
        firstName?.value ||
        requiresReview
      ) {
        latest = next;
        if (
          message &&
          !requiresReview &&
          message.textContent !== "A newer version of this form is available."
        )
          message.textContent = "A newer version of this form is available.";
        updateReview();
      } else {
        current = next;
        unavailable = false;
        if (loaded) render();
      }
    },
  };
}
