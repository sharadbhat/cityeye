/** Keep desktop clicks in the combobox without cancelling native touch taps/scrolls. */
export function preserveSearchFocus(event) {
  if (event.pointerType === 'mouse' && event.button === 0) event.preventDefault();
}

/** Dismiss outside interaction, not the transient null-focus blur of a mobile tap. */
export function attachCitySearchDismissal(root, dismiss) {
  if (!root) return () => {};
  const document = root.ownerDocument;
  const outside = event => {
    if (!root.contains(event.target)) dismiss();
  };
  const blur = event => {
    // Non-focusable suggestions can blur the input with no relatedTarget on phones.
    // Closing here would unmount the option before its native click can select it.
    if (event.relatedTarget && !root.contains(event.relatedTarget)) dismiss();
  };
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('click', outside, true);
  root.addEventListener('focusout', blur);
  return () => {
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('click', outside, true);
    root.removeEventListener('focusout', blur);
  };
}
