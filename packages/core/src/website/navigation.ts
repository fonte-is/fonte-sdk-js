export interface WebsiteOccurrence {
  href: string;
  navigation: boolean;
}

/** One document observer; its inert wrappers remain safe inside later host wrappers. */
export function observeWebsiteNavigation(
  onNavigation: (occurrence: WebsiteOccurrence) => void,
  onRefreshEvent: () => void,
): () => void {
  let active = true;
  let observedHref = window.location.href;
  const originalPush = window.history.pushState;
  const originalReplace = window.history.replaceState;
  const arrival = () => {
    if (!active) return;
    observedHref = window.location.href;
    onNavigation({ href: observedHref, navigation: true });
  };
  const push = function (
    this: History,
    ...args: Parameters<History["pushState"]>
  ) {
    const before = window.location.href;
    const result = originalPush.apply(this, args);
    if (active && before !== window.location.href) arrival();
    return result;
  };
  const replace = function (
    this: History,
    ...args: Parameters<History["replaceState"]>
  ) {
    const before = window.location.href;
    const result = originalReplace.apply(this, args);
    if (active && before !== window.location.href) arrival();
    return result;
  };
  const hash = () => {
    if (window.location.href !== observedHref) arrival();
  };
  const pageshow = (event: PageTransitionEvent) => {
    if (!active) return;
    if (event.persisted) arrival();
    else onRefreshEvent();
  };
  const focus = () => {
    if (active) onRefreshEvent();
  };
  window.history.pushState = push;
  window.history.replaceState = replace;
  window.addEventListener("popstate", arrival);
  window.addEventListener("hashchange", hash);
  window.addEventListener("pageshow", pageshow);
  window.addEventListener("focus", focus);
  return () => {
    if (!active) return;
    active = false;
    if (window.history.pushState === push)
      window.history.pushState = originalPush;
    if (window.history.replaceState === replace)
      window.history.replaceState = originalReplace;
    window.removeEventListener("popstate", arrival);
    window.removeEventListener("hashchange", hash);
    window.removeEventListener("pageshow", pageshow);
    window.removeEventListener("focus", focus);
  };
}
